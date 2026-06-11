import {DataSet, Network} from 'vis-network';
import {IController, IScope, ITimeoutService} from 'angular';
import ELK from 'elkjs/lib/elk.bundled';
import cytoscape from 'cytoscape';
import {IVisNode} from '@src/Tools/Production/Result/IVisNode';
import {IVisEdge} from '@src/Tools/Production/Result/IVisEdge';
import {IElkGraph} from '@src/Solver/IElkGraph';
import {Strings} from '@src/Utils/Strings';
import model from '@src/Data/Model';
import {ProductionResult} from '@src/Tools/Production/Result/ProductionResult';
import {GraphNode} from '@src/Tools/Production/Result/Nodes/GraphNode';
import {RecipeNode} from '@src/Tools/Production/Result/Nodes/RecipeNode';
import {MinerNode} from '@src/Tools/Production/Result/Nodes/MinerNode';
import {InputNode} from '@src/Tools/Production/Result/Nodes/InputNode';
import {ProductNode} from '@src/Tools/Production/Result/Nodes/ProductNode';
import {ByproductNode} from '@src/Tools/Production/Result/Nodes/ByproductNode';
import {SinkNode} from '@src/Tools/Production/Result/Nodes/SinkNode';

interface ISankeyNode
{
	id: number;
	label: string;
	type: string;
	color: string;
	level: number;
	value: number;
	incoming: number;
	outgoing: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ISankeyEdge
{
	id: number;
	from: ISankeyNode;
	to: ISankeyNode;
	item: string;
	itemName: string;
	amount: number;
	width: number;
	color: string;
	sourceY: number;
	targetY: number;
}

interface ISankeyPoint
{
	x: number;
	y: number;
}

interface ISankeyLayout
{
	width: number;
	height: number;
}

export class VisualizationComponentController implements IController
{

	public result: ProductionResult;
	public mode: string = 'diagram';

	public static $inject = ['$element', '$scope', '$timeout'];

	private unregisterWatcherCallback: () => void;
	private network: Network|undefined;
	private fitted: boolean = false;
	private sankeyDragCleanup: (() => void)|undefined;

	public constructor(private readonly $element: any, private readonly $scope: IScope, private readonly $timeout: ITimeoutService) {}


	public $onInit(): void
	{
		this.unregisterWatcherCallback = this.$scope.$watchGroup([
			() => this.result,
			() => this.mode,
		], (newValues) => {
			this.updateData(newValues[0] as ProductionResult|undefined);
		});
	}

	public $onDestroy(): void
	{
		this.unregisterWatcherCallback();
	}

	public useCytoscape(result: ProductionResult): void
	{
		this.resetContainer();
		const options: cytoscape.CytoscapeOptions = {
			container: this.$element[0],
		};
		options.layout = {
			name: 'elk',
			fit: true,
			padding: 200,
			nodeDimensionIncludeLabels: true,
			elk: {
				algorithm: 'layered',
				edgeRouting: 'POLYLINE',
				'spacing.nodeNode': 200,
			},
		} as any;

		const elements: cytoscape.ElementDefinition[] = [];
		for (const node of result.graph.nodes) {
			elements.push({
				data: {
					id: node.id.toString(),
					label: node.getTitle(),
				},
				position: {
					x: 1,
					y: 1,
				},
			});
		}

		for (const edge of result.graph.edges) {
			elements.push({
				data: {
					id: edge.id.toString(),
					source: edge.from.id.toString(),
					target: edge.to.id.toString(),
					label: edge.itemAmount.item,
				},
			});
		}

		options.elements = elements;
		options.style = [
			{
				selector: 'node[label]',
				style: {
					width: 'label',
					height: 'label',
					shape: 'round-rectangle',
					'font-size': '12px',
					label: 'data(label)',
					'text-valign': 'center',
					'text-halign': 'center',
				},
			},
			{
				selector: 'edge[label]',
				style: {
					label: 'data(label)',
					width: 3,
					'curve-style': 'segments',
				},
			},
		];

		const cy = cytoscape(options as any);
	}

	public useVis(result: ProductionResult): void
	{
		this.resetContainer();
		const nodes = new DataSet<IVisNode>();
		const edges = new DataSet<IVisEdge>();

		for (const node of result.graph.nodes) {
			nodes.add(node.getVisNode());
		}

		for (const edge of result.graph.edges) {
			const smooth: any = {
				enabled: false,
			};

			if (edge.to.hasOutputTo(edge.from)) {
				smooth.enabled = true;
				smooth.type = 'curvedCW'
				smooth.roundness = 0.2;
			}

			edges.add({
				id: edge.id,
				from: edge.from.id,
				to: edge.to.id,
				label: model.getItem(edge.itemAmount.item).prototype.name + '\n' + Strings.formatNumber(edge.itemAmount.amount) + ' / min',
				color: {
					color: 'rgba(105, 125, 145, 1)',
					highlight: 'rgba(134, 151, 167, 1)',
				},
				font: {
					color: 'rgba(238, 238, 238, 1)',
				},
				smooth: smooth,
			} as any);
		}

		this.network = this.drawVisualisation(nodes, edges);
		const network = this.network;

		this.$timeout(0).then(() => {
			const elkGraph: IElkGraph = {
				id: 'root',
				layoutOptions: {
					'elk.algorithm': 'org.eclipse.elk.layered',
					'org.eclipse.elk.layered.nodePlacement.favorStraightEdges': true as unknown as string, // fuck off typescript
					'org.eclipse.elk.spacing.nodeNode': 40 + '',
				},
				children: [],
				edges: [],
			};

			nodes.forEach((node) => {
				elkGraph.children.push({
					id: node.id.toString(),
					width: 250,
					height: 100,
				});
			});
			edges.forEach((edge) => {
				elkGraph.edges.push({
					id: '',
					source: edge.from.toString(),
					target: edge.to.toString(),
				});
			});

			this.$timeout(0).then(() => {
				const elk = new ELK();
				elk.layout(elkGraph).then((data) => {
					nodes.forEach((node) => {
						const id = node.id;
						if (data.children) {
							for (const item of data.children) {
								if (parseInt(item.id, 10) === id) {
									nodes.update({
										id: id,
										x: item.x,
										y: item.y,
									});
									return;
								}
							}
						}
					});

					if (!this.fitted && this.network === network) {
						this.fitted = true;
						network.redraw();
						network.fit();
					}
				});
			});
		});

		this.$timeout(500).then(() => {
			if (this.network === network) {
				network.redraw();
				network.fit();
			}
		});
	}

	public updateData(result: ProductionResult|undefined): void
	{
		if (!result) {
			return;
		}

		this.fitted = false;

		if (this.mode === 'sankey') {
			this.useSankey(result);
			return;
		}

		this.useVis(result);
	}

	public useSankey(result: ProductionResult): void
	{
		this.resetContainer();

		const graph = this.buildSankeyGraph(result);
		if (!graph.edges.length) {
			this.$element[0].innerHTML = '<div class="visualization-sankey-empty">No item flows to show.</div>';
			return;
		}

		const layout = this.layoutSankey(graph.nodes, graph.edges);

		const paths: string[] = [];
		const labels: string[] = [];

		for (const edge of graph.edges) {
			const title = this.escapeSvg(edge.from.label + ' -> ' + edge.to.label + '\n' + edge.itemName + ': ' + Strings.formatNumber(edge.amount) + ' / min');
			paths.push(
				'<path class="sankey-link" data-edge-id="' + edge.id + '" d="' + this.getSankeyPath(edge) + '" stroke="' + edge.color + '" stroke-width="' + edge.width + '">' +
					'<title>' + title + '</title>' +
				'</path>'
			);

			if (edge.width >= 22) {
				const label = this.getSankeyLabelPosition(edge);
				labels.push(
					'<text class="sankey-link-label" data-edge-id="' + edge.id + '" x="' + label.x + '" y="' + label.y + '">' +
						this.escapeSvg(edge.itemName + ' ' + Strings.formatNumber(edge.amount) + '/min') +
					'</text>'
				);
			}
		}

		const nodeMarkup: string[] = [];
		for (const node of graph.nodes) {
			const title = this.escapeSvg(node.label + '\nIn: ' + Strings.formatNumber(node.incoming) + ' / min\nOut: ' + Strings.formatNumber(node.outgoing) + ' / min');
			const label = this.getSankeyNodeLabelPosition(node);
			const hitBox = this.getSankeyNodeHitBox(node);
			nodeMarkup.push(
				'<g class="sankey-node sankey-node-' + node.type + '" data-node-id="' + node.id + '">' +
					'<rect class="sankey-node-hitbox" x="' + hitBox.x + '" y="' + hitBox.y + '" width="' + hitBox.width + '" height="' + hitBox.height + '">' +
						'<title>' + title + '</title>' +
					'</rect>' +
					'<rect class="sankey-node-bar" x="' + node.x + '" y="' + node.y + '" width="' + node.width + '" height="' + node.height + '" rx="2" ry="2" fill="' + node.color + '">' +
						'<title>' + title + '</title>' +
					'</rect>' +
					'<text class="sankey-node-label" x="' + label.x + '" y="' + label.y + '">' +
						this.getNodeLabelMarkup(node) +
					'</text>' +
				'</g>'
			);
		}

		this.$element[0].innerHTML =
			'<div class="visualization-sankey">' +
				'<svg width="' + layout.width + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + ' ' + layout.height + '" role="img" aria-label="Production Sankey graph">' +
					'<g class="sankey-links">' + paths.join('') + '</g>' +
					'<g class="sankey-link-labels">' + labels.join('') + '</g>' +
					'<g class="sankey-nodes">' + nodeMarkup.join('') + '</g>' +
				'</svg>' +
			'</div>';

		this.bindSankeyDragging(graph.nodes, graph.edges, layout.width, layout.height);
	}

	private drawVisualisation(nodes: DataSet<IVisNode>, edges: DataSet<IVisEdge>): Network
	{
		return new Network(this.$element[0], {
			nodes: nodes,
			edges: edges,
		}, {
			edges: {
				labelHighlightBold: false,
				font: {
					size: 14,
					multi: 'html',
					strokeColor: 'rgba(0, 0, 0, 0.2)',
				},
				arrows: 'to',
				smooth: false,
			},
			nodes: {
				labelHighlightBold: false,
				font: {
					// align: 'left',
					size: 14,
					multi: 'html',
				},
				margin: {
					top: 10,
					left: 10,
					right: 10,
					bottom: 10,
				},
				shape: 'box',
				widthConstraint: {
					minimum: 50,
					maximum: 250,
				},
				// widthConstraint: 225,
			},
			physics: {
				enabled: false,
			},
			layout: {
				improvedLayout: false,
				hierarchical: false,
			},
			interaction: {
				tooltipDelay: 0,
			},
		});
	}

	private resetContainer(): void
	{
		if (this.sankeyDragCleanup) {
			this.sankeyDragCleanup();
			this.sankeyDragCleanup = undefined;
		}
		if (this.network) {
			this.network.destroy();
			this.network = undefined;
		}
		this.$element[0].innerHTML = '';
	}

	private buildSankeyGraph(result: ProductionResult): {nodes: ISankeyNode[], edges: ISankeyEdge[]}
	{
		const nodes: ISankeyNode[] = [];
		const nodeMap: {[key: number]: ISankeyNode} = {};

		for (const graphNode of result.graph.nodes) {
			const node = this.createSankeyNode(graphNode);
			nodes.push(node);
			nodeMap[graphNode.id] = node;
		}

		const edges: ISankeyEdge[] = [];
		for (const graphEdge of result.graph.edges) {
			if (graphEdge.itemAmount.amount <= 0) {
				continue;
			}

			const from = nodeMap[graphEdge.from.id];
			const to = nodeMap[graphEdge.to.id];
			const amount = graphEdge.itemAmount.amount;
			const itemName = model.getItem(graphEdge.itemAmount.item).prototype.name;

			from.outgoing += amount;
			to.incoming += amount;
			edges.push({
				id: graphEdge.id,
				from: from,
				to: to,
				item: graphEdge.itemAmount.item,
				itemName: itemName,
				amount: amount,
				width: 0,
				color: this.getItemColor(graphEdge.itemAmount.item),
				sourceY: 0,
				targetY: 0,
			});
		}

		for (const node of nodes) {
			node.value = Math.max(node.incoming, node.outgoing, 1);
		}

		this.assignSankeyLevels(nodes, edges);
		return {
			nodes: nodes,
			edges: edges,
		};
	}

	private createSankeyNode(node: GraphNode): ISankeyNode
	{
		let type = 'recipe';
		let color = '#df691a';
		let label = this.plainText(node.getTitle());

		if (node instanceof RecipeNode) {
			label = node.recipeData.recipe.name;
		} else if (node instanceof MinerNode) {
			type = 'resource';
			color = '#4e5d6c';
			label = node.resource.name;
		} else if (node instanceof InputNode) {
			type = 'input';
			color = '#af6d0e';
			label = 'Input: ' + node.resource.name;
		} else if (node instanceof ProductNode) {
			type = 'product';
			color = '#50a050';
			label = node.resource.name;
		} else if (node instanceof ByproductNode) {
			type = 'byproduct';
			color = '#1b7089';
			label = 'Byproduct: ' + node.resource.name;
		} else if (node instanceof SinkNode) {
			type = 'sink';
			color = '#d9534f';
			label = 'Sink: ' + node.resource.name;
		}

		return {
			id: node.id,
			label: label,
			type: type,
			color: color,
			level: 0,
			value: 0,
			incoming: 0,
			outgoing: 0,
			x: 0,
			y: 0,
			width: 24,
			height: 48,
		};
	}

	private assignSankeyLevels(nodes: ISankeyNode[], edges: ISankeyEdge[]): void
	{
		const memo: {[key: number]: number} = {};
		const incoming: {[key: number]: ISankeyEdge[]} = {};

		for (const node of nodes) {
			incoming[node.id] = [];
		}
		for (const edge of edges) {
			if (edge.from !== edge.to) {
				incoming[edge.to.id].push(edge);
			}
		}

		const visit = (node: ISankeyNode, stack: {[key: number]: boolean}): number => {
			if (node.id in memo) {
				return memo[node.id];
			}
			if (stack[node.id]) {
				return 0;
			}

			stack[node.id] = true;
			let level = 0;
			for (const edge of incoming[node.id]) {
				level = Math.max(level, visit(edge.from, stack) + 1);
			}
			stack[node.id] = false;
			memo[node.id] = level;
			return level;
		};

		for (const node of nodes) {
			node.level = visit(node, {});
		}

		let maxProcessLevel = 0;
		for (const node of nodes) {
			if (node.type !== 'product' && node.type !== 'byproduct' && node.type !== 'sink') {
				maxProcessLevel = Math.max(maxProcessLevel, node.level);
			}
		}
		for (const node of nodes) {
			if (node.type === 'product' || node.type === 'byproduct' || node.type === 'sink') {
				node.level = Math.max(node.level, maxProcessLevel + 1);
			}
		}
	}

	private layoutSankey(nodes: ISankeyNode[], edges: ISankeyEdge[]): ISankeyLayout
	{
		const nodeWidth = 24;
		const columnGap = 236;
		const topPadding = 42;
		const nodePadding = 18;
		const leftPadding = 42;
		const labelWidth = 210;
		const targetMaxNodeHeight = 260;
		const maxLevel = this.getMaxLevel(nodes);
		const columns: {[key: number]: ISankeyNode[]} = {};

		for (const node of nodes) {
			node.width = nodeWidth;
			if (!columns[node.level]) {
				columns[node.level] = [];
			}
			columns[node.level].push(node);
		}

		const scale = this.getSankeyValueScale(nodes, targetMaxNodeHeight);
		this.applySankeyScale(nodes, edges, scale);
		const height = Math.max(760, this.getSankeyHeight(columns, topPadding, nodePadding));
		const width = Math.max(900, leftPadding * 2 + maxLevel * (nodeWidth + columnGap) + nodeWidth + labelWidth);

		for (let level = 0; level <= maxLevel; level++) {
			const column = columns[level] || [];
			column.sort((a, b) => {
				const aSort = this.getSankeyNodeSortY(a, edges);
				const bSort = this.getSankeyNodeSortY(b, edges);
				if (aSort !== bSort) {
					return aSort - bSort;
				}
				if (a.value !== b.value) {
					return b.value - a.value;
				}
				return a.label.localeCompare(b.label);
			});

			let y = topPadding;
			for (const node of column) {
				node.x = leftPadding + level * (nodeWidth + columnGap);
				node.y = y;
				y += node.height + nodePadding;
			}
		}

		this.positionSankeyLinks(nodes, edges);
		return {
			width: width,
			height: height,
		};
	}

	private positionSankeyLinks(nodes: ISankeyNode[], edges: ISankeyEdge[]): void
	{
		const gap = 0;
		const outgoing: {[key: number]: ISankeyEdge[]} = {};
		const incoming: {[key: number]: ISankeyEdge[]} = {};

		for (const node of nodes) {
			outgoing[node.id] = [];
			incoming[node.id] = [];
		}
		for (const edge of edges) {
			outgoing[edge.from.id].push(edge);
			incoming[edge.to.id].push(edge);
		}

		for (const node of nodes) {
			outgoing[node.id].sort((a, b) => a.to.y - b.to.y);
			incoming[node.id].sort((a, b) => a.from.y - b.from.y);

			let y = node.y + node.height / 2 - this.getLinkStackHeight(outgoing[node.id], gap) / 2;
			for (const edge of outgoing[node.id]) {
				edge.sourceY = y + edge.width / 2;
				y += edge.width + gap;
			}

			y = node.y + node.height / 2 - this.getLinkStackHeight(incoming[node.id], gap) / 2;
			for (const edge of incoming[node.id]) {
				edge.targetY = y + edge.width / 2;
				y += edge.width + gap;
			}
		}
	}

	private getSankeyValueScale(nodes: ISankeyNode[], targetMaxNodeHeight: number): number
	{
		let maxValue = 0;
		for (const node of nodes) {
			maxValue = Math.max(maxValue, node.value);
		}
		if (maxValue <= 0) {
			return 1;
		}
		return targetMaxNodeHeight / maxValue;
	}

	private applySankeyScale(nodes: ISankeyNode[], edges: ISankeyEdge[], scale: number): void
	{
		for (const edge of edges) {
			edge.width = Math.max(1, edge.amount * scale);
		}

		const outgoing: {[key: number]: ISankeyEdge[]} = {};
		const incoming: {[key: number]: ISankeyEdge[]} = {};
		for (const node of nodes) {
			outgoing[node.id] = [];
			incoming[node.id] = [];
		}
		for (const edge of edges) {
			outgoing[edge.from.id].push(edge);
			incoming[edge.to.id].push(edge);
		}

		for (const node of nodes) {
			node.height = Math.max(
				14,
				node.value * scale,
				this.getLinkStackHeight(outgoing[node.id], 0),
				this.getLinkStackHeight(incoming[node.id], 0)
			);
		}
	}

	private getSankeyHeight(columns: {[key: number]: ISankeyNode[]}, topPadding: number, nodePadding: number): number
	{
		let height = 0;
		for (const level in columns) {
			const column = columns[level];
			let columnHeight = topPadding * 2 + Math.max(0, column.length - 1) * nodePadding;
			for (const node of column) {
				columnHeight += node.height;
			}
			height = Math.max(height, columnHeight);
		}
		return Math.ceil(height);
	}

	private getSankeyNodeSortY(node: ISankeyNode, edges: ISankeyEdge[]): number
	{
		let total = 0;
		let weighted = 0;
		for (const edge of edges) {
			if (edge.to === node && edge.from.y > 0) {
				total += edge.width;
				weighted += (edge.from.y + edge.from.height / 2) * edge.width;
			}
		}
		if (total > 0) {
			return weighted / total;
		}
		return 0;
	}

	private getMaxLevel(nodes: ISankeyNode[]): number
	{
		let maxLevel = 0;
		for (const node of nodes) {
			maxLevel = Math.max(maxLevel, node.level);
		}
		return maxLevel;
	}

	private getLinkStackHeight(edges: ISankeyEdge[], gap: number): number
	{
		if (!edges.length) {
			return 0;
		}

		let total = -gap;
		for (const edge of edges) {
			total += edge.width + gap;
		}
		return total;
	}

	private getSankeyPath(edge: ISankeyEdge): string
	{
		const sourceX = edge.from.x + edge.from.width;
		const targetX = edge.to.x;
		const controlDistance = Math.max(80, Math.abs(targetX - sourceX) * 0.5);
		const direction = targetX >= sourceX ? 1 : -1;
		return 'M ' + sourceX + ' ' + edge.sourceY +
			' C ' + (sourceX + controlDistance * direction) + ' ' + edge.sourceY +
			', ' + (targetX - controlDistance * direction) + ' ' + edge.targetY +
			', ' + targetX + ' ' + edge.targetY;
	}

	private getSankeyNodeLabelPosition(node: ISankeyNode): ISankeyPoint
	{
		return {
			x: node.x + node.width + 10,
			y: node.y + Math.max(13, Math.min(18, node.height / 2 + 4)),
		};
	}

	private getSankeyNodeHitBox(node: ISankeyNode): {x: number, y: number, width: number, height: number}
	{
		return {
			x: node.x,
			y: node.y - 6,
			width: node.width + 190,
			height: Math.max(36, node.height + 12),
		};
	}

	private getSankeyLabelPosition(edge: ISankeyEdge): ISankeyPoint
	{
		const sourceX = edge.from.x + edge.from.width;
		const targetX = edge.to.x;
		return {
			x: (sourceX + targetX) / 2,
			y: (edge.sourceY + edge.targetY) / 2 - Math.max(8, edge.width / 2),
		};
	}

	private bindSankeyDragging(nodes: ISankeyNode[], edges: ISankeyEdge[], width: number, height: number): void
	{
		if (this.sankeyDragCleanup) {
			this.sankeyDragCleanup();
			this.sankeyDragCleanup = undefined;
		}

		const svg = this.$element[0].querySelector('.visualization-sankey svg') as SVGSVGElement|null;
		if (!svg) {
			return;
		}

		const nodeById: {[key: number]: ISankeyNode} = {};
		for (const node of nodes) {
			nodeById[node.id] = node;
		}

		let activeNode: ISankeyNode|null = null;
		let activeNodeElement: Element|null = null;
		let startPointer: ISankeyPoint = {x: 0, y: 0};
		let startNodeX = 0;
		let startNodeY = 0;
		let moveHandler: (event: Event) => void;
		let endHandler: () => void;

		const getPoint = (event: MouseEvent|TouchEvent): ISankeyPoint => {
			let clientX = 0;
			let clientY = 0;
			const touchEvent = event as TouchEvent;
			if (touchEvent.touches && touchEvent.touches.length) {
				clientX = touchEvent.touches[0].clientX;
				clientY = touchEvent.touches[0].clientY;
			} else if (touchEvent.changedTouches && touchEvent.changedTouches.length) {
				clientX = touchEvent.changedTouches[0].clientX;
				clientY = touchEvent.changedTouches[0].clientY;
			} else {
				const mouseEvent = event as MouseEvent;
				clientX = mouseEvent.clientX;
				clientY = mouseEvent.clientY;
			}

			const rect = svg.getBoundingClientRect();
			const viewBox = svg.viewBox.baseVal;
			const scaleX = rect.width ? viewBox.width / rect.width : 1;
			const scaleY = rect.height ? viewBox.height / rect.height : 1;
			return {
				x: viewBox.x + (clientX - rect.left) * scaleX,
				y: viewBox.y + (clientY - rect.top) * scaleY,
			};
		};

		const removeDocumentListeners = () => {
			document.removeEventListener('mousemove', moveHandler);
			document.removeEventListener('mouseup', endHandler);
			document.removeEventListener('touchmove', moveHandler);
			document.removeEventListener('touchend', endHandler);
			document.removeEventListener('touchcancel', endHandler);
		};

		const startHandler = (event: Event) => {
			const nodeElement = event.currentTarget as Element;
			const nodeId = parseInt(nodeElement.getAttribute('data-node-id') || '', 10);
			const node = nodeById[nodeId];
			if (!node) {
				return;
			}

			if (event.cancelable) {
				event.preventDefault();
			}

			activeNode = node;
			activeNodeElement = nodeElement;
			startPointer = getPoint(event as MouseEvent|TouchEvent);
			startNodeX = node.x;
			startNodeY = node.y;
			nodeElement.classList.add('dragging');
			svg.classList.add('sankey-dragging');

			removeDocumentListeners();
			document.addEventListener('mousemove', moveHandler);
			document.addEventListener('mouseup', endHandler);
			document.addEventListener('touchmove', moveHandler, {passive: false});
			document.addEventListener('touchend', endHandler);
			document.addEventListener('touchcancel', endHandler);
		};

		moveHandler = (event: Event) => {
			if (!activeNode) {
				return;
			}

			if (event.cancelable) {
				event.preventDefault();
			}

			const pointer = getPoint(event as MouseEvent|TouchEvent);
			activeNode.x = Math.max(0, Math.min(width - activeNode.width - 190, startNodeX + pointer.x - startPointer.x));
			activeNode.y = Math.max(0, Math.min(height - activeNode.height, startNodeY + pointer.y - startPointer.y));
			this.positionSankeyLinks(nodes, edges);
			this.updateSankeyNode(activeNode, svg);
			this.updateSankeyEdges(edges, svg);
		};

		endHandler = () => {
			if (activeNodeElement) {
				activeNodeElement.classList.remove('dragging');
			}
			svg.classList.remove('sankey-dragging');
			activeNode = null;
			activeNodeElement = null;
			removeDocumentListeners();
		};

		const nodeElements = Array.from(svg.querySelectorAll('.sankey-node'));
		for (const nodeElement of nodeElements) {
			nodeElement.addEventListener('mousedown', startHandler);
			nodeElement.addEventListener('touchstart', startHandler, {passive: false});
		}

		this.sankeyDragCleanup = () => {
			removeDocumentListeners();
			for (const nodeElement of nodeElements) {
				nodeElement.removeEventListener('mousedown', startHandler);
				nodeElement.removeEventListener('touchstart', startHandler);
			}
		};
	}

	private updateSankeyNode(node: ISankeyNode, svg: SVGSVGElement): void
	{
		const nodeElement = svg.querySelector('.sankey-node[data-node-id="' + node.id + '"]');
		if (!nodeElement) {
			return;
		}

		const bar = nodeElement.querySelector('.sankey-node-bar');
		if (bar) {
			bar.setAttribute('x', node.x + '');
			bar.setAttribute('y', node.y + '');
		}

		const hitBox = nodeElement.querySelector('.sankey-node-hitbox');
		if (hitBox) {
			const bounds = this.getSankeyNodeHitBox(node);
			hitBox.setAttribute('x', bounds.x + '');
			hitBox.setAttribute('y', bounds.y + '');
			hitBox.setAttribute('width', bounds.width + '');
			hitBox.setAttribute('height', bounds.height + '');
		}

		const text = nodeElement.querySelector('text');
		if (text) {
			const label = this.getSankeyNodeLabelPosition(node);
			text.setAttribute('x', label.x + '');
			text.setAttribute('y', label.y + '');
			const tspans = Array.from(text.querySelectorAll('tspan'));
			for (const tspan of tspans) {
				tspan.setAttribute('x', label.x + '');
			}
		}
	}

	private updateSankeyEdges(edges: ISankeyEdge[], svg: SVGSVGElement): void
	{
		for (const edge of edges) {
			const path = svg.querySelector('path.sankey-link[data-edge-id="' + edge.id + '"]');
			if (path) {
				path.setAttribute('d', this.getSankeyPath(edge));
			}

			const label = svg.querySelector('text.sankey-link-label[data-edge-id="' + edge.id + '"]');
			if (label) {
				const position = this.getSankeyLabelPosition(edge);
				label.setAttribute('x', position.x + '');
				label.setAttribute('y', position.y + '');
			}
		}
	}

	private getNodeLabelMarkup(node: ISankeyNode): string
	{
		const labelPosition = this.getSankeyNodeLabelPosition(node);
		const label = this.escapeSvg(this.truncateSankeyLabel(node.label));
		const amount = Strings.formatNumber(node.value) + ' / min';
		return '<tspan x="' + labelPosition.x + '" dy="0">' + label + '</tspan>' +
			'<tspan class="sankey-node-value" x="' + labelPosition.x + '" dy="17">' + this.escapeSvg(amount) + '</tspan>';
	}

	private truncateSankeyLabel(label: string): string
	{
		if (label.length <= 27) {
			return label;
		}
		return label.slice(0, 24) + '...';
	}

	private getItemColor(item: string): string
	{
		const palette = [
			'#6bbf59',
			'#49a5c7',
			'#f0ad4e',
			'#d9534f',
			'#8f7fd1',
			'#5bc0de',
			'#b6d957',
			'#e08283',
			'#77aadd',
			'#ddcc77',
		];
		let hash = 0;
		for (let i = 0; i < item.length; i++) {
			hash = ((hash << 5) - hash) + item.charCodeAt(i);
			hash = hash & hash;
		}
		return palette[Math.abs(hash) % palette.length];
	}

	private plainText(value: string): string
	{
		return value.replace(/<[^>]*>/g, '').replace(/\s*\n\s*/g, ' - ');
	}

	private escapeSvg(value: string): string
	{
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

}
