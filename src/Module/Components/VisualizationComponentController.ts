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

export class VisualizationComponentController implements IController
{

	public result: ProductionResult;
	public mode: string = 'diagram';

	public static $inject = ['$element', '$scope', '$timeout'];

	private unregisterWatcherCallback: () => void;
	private network: Network|undefined;
	private fitted: boolean = false;

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

		this.layoutSankey(graph.nodes, graph.edges);

		const width = Math.max(900, (this.getMaxLevel(graph.nodes) + 1) * 260);
		const height = Math.max(760, this.getSankeyHeight(graph.nodes));
		const paths: string[] = [];
		const labels: string[] = [];

		for (const edge of graph.edges) {
			const sourceX = edge.from.x + edge.from.width;
			const targetX = edge.to.x;
			const controlDistance = Math.max(80, (targetX - sourceX) * 0.5);
			const path = 'M ' + sourceX + ' ' + edge.sourceY +
				' C ' + (sourceX + controlDistance) + ' ' + edge.sourceY +
				', ' + (targetX - controlDistance) + ' ' + edge.targetY +
				', ' + targetX + ' ' + edge.targetY;
			const title = this.escapeSvg(edge.from.label + ' -> ' + edge.to.label + '\n' + edge.itemName + ': ' + Strings.formatNumber(edge.amount) + ' / min');
			paths.push(
				'<path class="sankey-link" d="' + path + '" stroke="' + edge.color + '" stroke-width="' + edge.width + '">' +
					'<title>' + title + '</title>' +
				'</path>'
			);

			if (edge.width >= 8) {
				const labelX = (sourceX + targetX) / 2;
				const labelY = (edge.sourceY + edge.targetY) / 2 - Math.max(8, edge.width / 2);
				labels.push(
					'<text class="sankey-link-label" x="' + labelX + '" y="' + labelY + '">' +
						this.escapeSvg(edge.itemName + ' ' + Strings.formatNumber(edge.amount) + '/min') +
					'</text>'
				);
			}
		}

		const nodeMarkup: string[] = [];
		for (const node of graph.nodes) {
			const title = this.escapeSvg(node.label + '\nIn: ' + Strings.formatNumber(node.incoming) + ' / min\nOut: ' + Strings.formatNumber(node.outgoing) + ' / min');
			nodeMarkup.push(
				'<g class="sankey-node sankey-node-' + node.type + '">' +
					'<rect x="' + node.x + '" y="' + node.y + '" width="' + node.width + '" height="' + node.height + '" rx="4" ry="4" fill="' + node.color + '">' +
						'<title>' + title + '</title>' +
					'</rect>' +
					'<text class="sankey-node-label" x="' + (node.x + 10) + '" y="' + (node.y + 18) + '">' +
						this.getNodeLabelMarkup(node) +
					'</text>' +
				'</g>'
			);
		}

		this.$element[0].innerHTML =
			'<div class="visualization-sankey">' +
				'<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Production Sankey graph">' +
					'<g class="sankey-links">' + paths.join('') + '</g>' +
					'<g class="sankey-link-labels">' + labels.join('') + '</g>' +
					'<g class="sankey-nodes">' + nodeMarkup.join('') + '</g>' +
				'</svg>' +
			'</div>';
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

		let maxAmount = 0;
		for (const edge of result.graph.edges) {
			maxAmount = Math.max(maxAmount, edge.itemAmount.amount);
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
			const width = maxAmount > 0 ? 2 + (amount / maxAmount) * 38 : 2;

			from.outgoing += amount;
			to.incoming += amount;
			edges.push({
				id: graphEdge.id,
				from: from,
				to: to,
				item: graphEdge.itemAmount.item,
				itemName: itemName,
				amount: amount,
				width: width,
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
			width: 180,
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

	private layoutSankey(nodes: ISankeyNode[], edges: ISankeyEdge[]): void
	{
		const nodeWidth = 180;
		const columnGap = 80;
		const topPadding = 42;
		const nodePadding = 26;
		const maxLevel = this.getMaxLevel(nodes);
		const columns: {[key: number]: ISankeyNode[]} = {};

		for (const node of nodes) {
			node.width = nodeWidth;
			if (!columns[node.level]) {
				columns[node.level] = [];
			}
			columns[node.level].push(node);
		}

		const height = Math.max(760, this.getSankeyHeight(nodes));
		const scale = this.getSankeyValueScale(columns, height, topPadding, nodePadding);

		for (let level = 0; level <= maxLevel; level++) {
			const column = columns[level] || [];
			column.sort((a, b) => {
				const aSort = a.y || 0;
				const bSort = b.y || 0;
				if (aSort !== bSort) {
					return aSort - bSort;
				}
				return a.label < b.label ? -1 : 1;
			});

			let y = topPadding;
			for (const node of column) {
				node.x = 42 + level * (nodeWidth + columnGap);
				node.height = Math.max(44, Math.min(180, node.value * scale));
				node.y = y;
				y += node.height + nodePadding;
			}
		}

		this.positionSankeyLinks(nodes, edges);
	}

	private positionSankeyLinks(nodes: ISankeyNode[], edges: ISankeyEdge[]): void
	{
		const gap = 2;
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

	private getSankeyValueScale(columns: {[key: number]: ISankeyNode[]}, height: number, topPadding: number, nodePadding: number): number
	{
		let scale = 10;
		for (const level in columns) {
			const column = columns[level];
			let total = 0;
			for (const node of column) {
				total += node.value;
			}
			if (total > 0) {
				const available = height - topPadding * 2 - Math.max(0, column.length - 1) * nodePadding;
				scale = Math.min(scale, available / total);
			}
		}
		return Math.max(0.08, scale);
	}

	private getSankeyHeight(nodes: ISankeyNode[]): number
	{
		const counts: {[key: number]: number} = {};
		let maxCount = 0;
		for (const node of nodes) {
			counts[node.level] = (counts[node.level] || 0) + 1;
			maxCount = Math.max(maxCount, counts[node.level]);
		}
		return 84 + maxCount * 74;
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

	private getNodeLabelMarkup(node: ISankeyNode): string
	{
		const label = this.escapeSvg(node.label);
		const amount = Strings.formatNumber(node.value) + ' / min';
		return '<tspan x="' + (node.x + 10) + '" dy="0">' + label + '</tspan>' +
			'<tspan class="sankey-node-value" x="' + (node.x + 10) + '" dy="18">' + this.escapeSvg(amount) + '</tspan>';
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
