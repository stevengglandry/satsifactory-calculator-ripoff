import {IAugmentedJQuery, IComponentController, IOnChangesObject, IScope, ITimeoutService} from 'angular';
import * as L from 'leaflet';
import {IMapOverlay, IMapOverlayCandidate, IMapOverlayNode, IOccupiedFactoryArea, ITransportRoutePoint} from '@src/AgentPlanner/Types';

interface IPlannerMapFilters
{
	purities: {[purity: string]: boolean};
	resources: {[item: string]: boolean};
	untappedOnly: boolean;
	showFactories: boolean;
	showRoutes: boolean;
	fitRequest: number;
}

export class PlannerMapComponentController implements IComponentController
{
	public mapData: IMapOverlay|null = null;
	public imageUrl = '';
	public factoryAreas: IOccupiedFactoryArea[] = [];
	public routes: ITransportRoutePoint[] = [];
	public filters: IPlannerMapFilters|null = null;
	public onCandidateSelect!: (locals: {candidateId: string}) => void;

	private map: L.Map|null = null;
	private imageLayer: L.ImageOverlay|null = null;
	private nodeLayer = L.layerGroup();
	private candidateLayer = L.layerGroup();
	private contextLayer = L.layerGroup();
	private lastFitRequest = -1;

	public static $inject = ['$element', '$scope', '$timeout'];

	public constructor(private readonly $element: IAugmentedJQuery, private readonly $scope: IScope, private readonly $timeout: ITimeoutService)
	{
	}

	public $postLink(): void
	{
		this.$timeout(() => {
			this.createMap();
			this.render();
		});
	}

	public $onChanges(changes: IOnChangesObject): void
	{
		if (changes.imageUrl && !changes.imageUrl.isFirstChange()) {
			this.imageLayer = null;
		}
		this.$timeout(() => this.render());
	}

	public $onDestroy(): void
	{
		if (this.map) {
			this.map.remove();
			this.map = null;
		}
	}

	private createMap(): void
	{
		if (this.map) {
			return;
		}
		const element = this.$element[0].querySelector('.planner-map-canvas') as HTMLElement|null;
		if (!element) {
			return;
		}
		this.map = L.map(element, {
			crs: L.CRS.Simple,
			minZoom: -12,
			maxZoom: -5,
			zoomSnap: 0.25,
			zoomControl: true,
			attributionControl: false,
		});
		this.nodeLayer.addTo(this.map);
		this.candidateLayer.addTo(this.map);
		this.contextLayer.addTo(this.map);
	}

	private render(): void
	{
		if (!this.map || !this.mapData) {
			return;
		}
		const bounds = this.getImageBounds(this.mapData);
		if (!this.imageLayer && this.imageUrl) {
			this.imageLayer = L.imageOverlay(this.imageUrl, bounds, {
				opacity: 0.88,
				interactive: false,
			}).addTo(this.map);
			this.map.fitBounds(bounds, {padding: [8, 8]});
		}
		this.renderNodes();
		this.renderCandidates();
		this.renderContext();
		if (this.filters && this.filters.fitRequest !== this.lastFitRequest) {
			this.lastFitRequest = this.filters.fitRequest;
			this.fitSelection(bounds);
		}
		this.map.invalidateSize(false);
	}

	private renderNodes(): void
	{
		if (!this.mapData) {
			return;
		}
		this.nodeLayer.clearLayers();
		for (const node of this.mapData.nodes) {
			if (!this.isNodeVisible(node)) {
				continue;
			}
			const color = node.selected ? '#61dff5' : node.tapped ? '#a2abb4' : '#f4f6f8';
			const marker = L.circleMarker(this.toLatLng(node), {
				radius: node.selected ? 7 : 4.5,
				color: color,
				weight: node.selected ? 3 : 1.5,
				fillColor: this.getPurityColor(node.purity),
				fillOpacity: node.selected ? 1 : 0.72,
				opacity: node.tapped ? 0.65 : 1,
			});
			marker.bindTooltip(node.itemName + ' · ' + node.purity + ' · ' + this.formatRate(node.rate) + '/min' + (node.tapped ? ' · tapped' : ''), {
				direction: 'top',
				offset: [0, -6],
			});
			marker.addTo(this.nodeLayer);
		}
	}

	private renderCandidates(): void
	{
		if (!this.mapData) {
			return;
		}
		this.candidateLayer.clearLayers();
		for (const candidate of this.mapData.candidates) {
			if (candidate.selected) {
				L.circle(this.toLatLng(candidate), {
					radius: candidate.radius,
					color: '#f57c16',
					weight: 3,
					fillColor: '#f57c16',
					fillOpacity: 0.08,
				}).addTo(this.candidateLayer);
			}
			const marker = L.marker(this.toLatLng(candidate), {
				icon: L.divIcon({
					className: 'planner-candidate-marker' + (candidate.selected ? ' is-selected' : ''),
					html: '<span>' + candidate.label + '</span>',
					iconSize: [38, 46],
					iconAnchor: [19, 40],
				}),
			});
			marker.bindTooltip(candidate.name + ' · score ' + Math.round(candidate.score), {direction: 'top'});
			marker.on('click', () => {
				this.$scope.$evalAsync(() => this.onCandidateSelect({candidateId: candidate.id}));
			});
			marker.addTo(this.candidateLayer);
		}
	}

	private renderContext(): void
	{
		this.contextLayer.clearLayers();
		if (!this.filters) {
			return;
		}
		if (this.filters.showFactories) {
			for (const area of this.factoryAreas || []) {
				L.circle(this.toLatLng(area.center), {
					radius: Math.max(5000, area.radius || 10000),
					color: '#77a8c9',
					weight: 1,
					fillColor: '#77a8c9',
					fillOpacity: 0.08,
					dashArray: '5 5',
				}).bindTooltip(area.name + ' · ' + area.buildingCount + ' buildings').addTo(this.contextLayer);
			}
		}
		if (this.filters.showRoutes) {
			for (const route of this.routes || []) {
				L.circleMarker(this.toLatLng(route.location), {
					radius: route.type === 'trainStation' || route.type === 'truckStop' ? 4 : 2,
					color: '#71c79d',
					weight: 1,
					fillColor: '#71c79d',
					fillOpacity: 0.8,
				}).bindTooltip(route.type).addTo(this.contextLayer);
			}
		}
	}

	private fitSelection(fallbackBounds: L.LatLngBoundsExpression): void
	{
		if (!this.map || !this.mapData) {
			return;
		}
		const selected = this.mapData.nodes.filter((node) => node.selected).map((node) => this.toLatLng(node));
		if (selected.length) {
			this.map.fitBounds(L.latLngBounds(selected), {padding: [70, 70], maxZoom: -9});
		} else {
			this.map.fitBounds(fallbackBounds, {padding: [8, 8]});
		}
	}

	private isNodeVisible(node: IMapOverlayNode): boolean
	{
		if (!this.filters) {
			return true;
		}
		return this.filters.purities[node.purity] !== false
			&& this.filters.resources[node.item] !== false
			&& (!this.filters.untappedOnly || !node.tapped || node.selected);
	}

	private getImageBounds(data: IMapOverlay): L.LatLngBoundsExpression
	{
		return [
			[-data.bounds.maxY, data.bounds.minX],
			[-data.bounds.minY, data.bounds.maxX],
		];
	}

	private toLatLng(point: {x: number, y: number}): L.LatLngExpression
	{
		return [-point.y, point.x];
	}

	private getPurityColor(purity: string): string
	{
		if (purity === 'pure') {
			return '#f2c14e';
		}
		if (purity === 'normal') {
			return '#49bd91';
		}
		return '#8e969e';
	}

	private formatRate(value: number): string
	{
		return isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '0';
	}
}
