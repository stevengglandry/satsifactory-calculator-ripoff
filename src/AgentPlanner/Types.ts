import {IProductionData, IProductionDataApiRequest} from '@src/Tools/Production/IProductionData';
import {ProductionResult} from '@src/Tools/Production/Result/ProductionResult';
import {IProjectAssemblyProgress} from '@src/AgentPlanner/ProjectAssembly';

export type PlannerStrategyId = 'planA'|'planB'|'planC'|'planD'|'planE'|'fastestUnlock'|'throughputOutpost'|'infrastructureFirst';
export type ResourcePurity = 'impure'|'normal'|'pure';
export type PlannerConfidence = 'high'|'inferred'|'unknown';

export interface IMapPoint
{
	x: number;
	y: number;
	z?: number;
}

export interface IWorldResourceNode
{
	id: string;
	item: string;
	purity: ResourcePurity;
	location: IMapPoint;
	region: string;
	source?: 'save'|'catalog';
	note?: string;
}

export interface IWorldResourceWell
{
	id: string;
	item: string;
	location: IMapPoint;
	satellites: Array<{
		id: string;
		location: IMapPoint;
		purity: ResourcePurity;
	}>;
}

export interface ITappedResourceNode extends IWorldResourceNode
{
	existingMinerClass: string|null;
	distanceToSaveObject: number;
}

export interface IFactoryCluster
{
	id: string;
	name: string;
	center: IMapPoint;
	buildingCount: number;
	radius?: number;
}

export interface IOccupiedFactoryArea extends IFactoryCluster
{
	min: IMapPoint;
	max: IMapPoint;
}

export interface IProductionRateSummary
{
	item: string;
	potentialRate: number;
	machineCount: number;
	confidence: PlannerConfidence;
	recipes: Array<{
		recipe: string;
		machine: string;
		machineCount: number;
		potentialRate: number;
	}>;
	warnings: string[];
}

export interface IResourceStatus
{
	total: number;
	tapped: number;
	untapped: number;
	unknown: number;
}

export interface ITransportRoutePoint
{
	id: string;
	type: 'trainStation'|'trainTrack'|'truckStop'|'truckPath'|'dronePort'|'hypertube';
	name: string;
	location: IMapPoint;
}

export interface IPlannerRecipePolicy
{
	allowLockedRecipePreview: boolean;
	allowSamResourceConversion: boolean;
}

export interface IAgentGameState
{
	saveName: string;
	gameVersion: string;
	parsedAt: string;
	objectCount: number;
	buildingCount: number;
	worldResourceNodes: IWorldResourceNode[];
	resourceWells: IWorldResourceWell[];
	tappedNodes: ITappedResourceNode[];
	factoryClusters: IFactoryCluster[];
	occupiedFactoryAreas: IOccupiedFactoryArea[];
	resourceStatus: {[item: string]: IResourceStatus};
	productionRates: {[item: string]: IProductionRateSummary};
	playerLocation: IMapPoint|null;
	transportRoutes: ITransportRoutePoint[];
	projectAssembly: IProjectAssemblyProgress|null;
	availableRecipes: string[];
	unlockedSchematics: string[];
	activeSchematic: string|null;
	inventoryTotals: {[item: string]: number};
	buildingCounts: {[buildingClassName: string]: number};
	notes: string[];
}

export interface IResourceClusterCandidate
{
	id: string;
	name: string;
	center: IMapPoint;
	nodes: IWorldResourceNode[];
	score: number;
	coverageScore: number;
	throughputScore: number;
	logisticsScore: number;
	routeScore: number;
	occupiedAreaScore: number;
	playerScore: number;
	tappedPenalty: number;
	requiredResources: string[];
	missingResources: string[];
}

export interface IMapOverlayNode
{
	id: string;
	item: string;
	itemName: string;
	purity: ResourcePurity;
	rate: number;
	x: number;
	y: number;
	xPercent: number;
	yPercent: number;
	tapped: boolean;
	selected: boolean;
	applicable: boolean;
	source: 'save'|'catalog';
	note?: string;
}

export interface IMapOverlayCandidate
{
	id: string;
	label: string;
	name: string;
	score: number;
	x: number;
	y: number;
	xPercent: number;
	yPercent: number;
	radius: number;
	selected: boolean;
}

export interface IMapOverlay
{
	bounds: {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	};
	nodes: IMapOverlayNode[];
	candidates: IMapOverlayCandidate[];
	center: {
		x: number;
		y: number;
		xPercent: number;
		yPercent: number;
	};
}

export interface IFactoryPlanOption
{
	id: string;
	strategy: PlannerStrategyId;
	planLabel: string;
	strategyLabel: string;
	summary: string;
	targetReason: string;
	targetItems: string[];
	targetDisplay: string;
	directRemaining: number;
	absoluteRemaining: number;
	recommendedRate: number;
	quantityBasis: 'direct'|'absolute'|'custom';
	confidence: PlannerConfidence;
	applicableResources: string[];
	selectedResourceNodes: IWorldResourceNode[];
	factoryArea: IFactoryCluster;
	scoreDetails: {
		coverage: number;
		throughput: number;
		logistics: number;
		route: number;
		occupiedArea: number;
		player: number;
		tappedPenalty: number;
	};
	cluster: IResourceClusterCandidate;
	candidateClusters: IResourceClusterCandidate[];
	request: IProductionDataApiRequest;
	productionData: IProductionData;
	result: ProductionResult|null;
	powerMw: number;
	machineCount: number;
	rawResourceUse: {[key: string]: number};
	buildingCosts: {[key: string]: number};
	warnings: string[];
	map: IMapOverlay;
}

export interface IPlannerSession
{
	id: string;
	saveName: string;
	createdAt: string;
	state: IAgentGameState;
	options: IFactoryPlanOption[];
	planningHorizonHours: number;
	recipePolicy: IPlannerRecipePolicy;
	selectedOptionId: string|null;
	notes: string[];
}
