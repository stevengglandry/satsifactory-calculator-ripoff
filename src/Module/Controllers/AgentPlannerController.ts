import angular, {IScope, ITimeoutService} from 'angular';
import {StateService} from 'angular-ui-router';
import data from '@src/Data/Data';
import {SaveGameStateExtractor} from '@src/AgentPlanner/SaveGameStateExtractor';
import {FactoryPlanner} from '@src/AgentPlanner/FactoryPlanner';
import {IAgentGameState, IFactoryPlanOption, IMapOverlayNode, IPlannerSession, IResourceClusterCandidate, IWorldResourceNode} from '@src/AgentPlanner/Types';
import {IProjectAssemblyPartProgress} from '@src/AgentPlanner/ProjectAssembly';
import {DataStorageService} from '@src/Module/Services/DataStorageService';
import {IRootScope} from '@src/Types/IRootScope';
import {Strings} from '@src/Utils/Strings';
import {IProductionData} from '@src/Tools/Production/IProductionData';
import {AppPath} from '@src/Utils/AppPath';

interface IPlannerTargetOption
{
	item: string;
	name: string;
}

interface IPlannerAction
{
	icon: string;
	title: string;
	detail: string;
}

export class AgentPlannerController
{

	public sessions: IPlannerSession[] = [];
	public session: IPlannerSession|null = null;
	public selectedOption: IFactoryPlanOption|null = null;
	public mapOption: IFactoryPlanOption|null = null;
	public customOption: IFactoryPlanOption|null = null;
	public loading = false;
	public status = '';
	public error = '';
	public customTargetItem = '';
	public customTargetRate = 5;
	public customTargetOptions: IPlannerTargetOption[] = [];
	public readonly horizonOptions = [5, 10, 20, 40];
	public readonly phaseSteps = [1, 2, 3, 4, 5];
	public planningHorizonHours = 10;
	public resourceFilterOpen = false;
	public mapFilters = {
		purities: {impure: true, normal: true, pure: true} as {[key: string]: boolean},
		resources: {} as {[key: string]: boolean},
		untappedOnly: false,
		showFactories: true,
		showRoutes: true,
		fitRequest: 0,
	};
	public readonly worldMapImage = AppPath.asset('assets/images/planner-biome-map.jpg');

	private readonly extractor = new SaveGameStateExtractor;
	private readonly planner = new FactoryPlanner;
	private readonly storageKey: string;
	private saveInputElement: HTMLInputElement|null = null;
	private saveInputChangeHandler: ((event: Event) => void)|null = null;
	private plannerActionsCache: IPlannerAction[] = [];
	private plannerActionsOption: IFactoryPlanOption|null = null;
	private plannerActionsSession: IPlannerSession|null = null;

	public static $inject = ['$timeout', '$scope', 'DataStorageService', '$state', '$rootScope'];

	public constructor(
		private readonly $timeout: ITimeoutService,
		$scope: IScope,
		private readonly dataStorageService: DataStorageService,
		private readonly $state: StateService,
		private readonly $rootScope: IRootScope,
	)
	{
		this.storageKey = 'agentPlannerSessions-' + $rootScope.version;
		this.customTargetOptions = this.createCustomTargetOptions();
		this.customTargetItem = this.customTargetOptions[0]?.item || '';
		this.loadSessions();
		this.$timeout(() => {
			this.attachSaveInputChangeHandler();
		});
		document.body.classList.add('agent-planner-page');
		$scope.$on('$destroy', () => {
			this.detachSaveInputChangeHandler();
			document.body.classList.remove('agent-planner-page');
		});
	}

	public tryImport(input?: HTMLInputElement|null): void
	{
		if (this.loading) {
			return;
		}

		input = input || document.getElementById('plannerSaveFile') as HTMLInputElement|null;
		const files = input?.files;
		if (!files || !files.length) {
			this.error = 'Choose a .sav file first.';
			return;
		}

		const file = files[0];
		this.loading = true;
		this.error = '';
		this.status = 'Parsing save...';

		this.extractor.extractFromFile(file, this.$rootScope.version).then((state) => {
			this.$timeout(0).then(() => {
				this.status = 'Generating planner options...';
				const session = this.planner.createSession(state, this.$rootScope.version, this.planningHorizonHours);
				this.addSession(session);
				this.status = 'Planner options generated.';
				this.loading = false;
				if (input) {
					input.value = '';
				}
			});
		}).catch((error) => {
			this.$timeout(0).then(() => {
				this.loading = false;
				this.status = '';
				this.error = 'Could not parse this save file: ' + (error && error.message ? error.message : error);
			});
		});
	}

	public selectSession(session: IPlannerSession): void
	{
		this.session = session;
		this.planningHorizonHours = session.planningHorizonHours || 10;
		this.customOption = session.options.find((option) => {
			return option.strategy === 'planD';
		}) || null;
		this.selectedOption = session.options.find((option) => option.id === session.selectedOptionId) || session.options[0] || null;
		this.mapOption = this.selectedOption;
		this.syncResourceFilters();
	}

	public selectOption(option: IFactoryPlanOption): void
	{
		this.selectedOption = option;
		this.mapOption = option;
		this.syncResourceFilters();
	}

	public showResourceMap(option: IFactoryPlanOption): void
	{
		this.mapOption = option;
		this.selectedOption = option;
	}

	public updatePlanningHorizon(): void
	{
		if (!this.session) {
			return;
		}
		const horizon = this.horizonOptions.indexOf(Number(this.planningHorizonHours)) !== -1 ? Number(this.planningHorizonHours) : 10;
		this.planningHorizonHours = horizon;
		const previousSession = this.session;
		const selectedStrategy = this.selectedOption?.strategy || 'planA';
		const customOption = previousSession.options.find((option) => option.strategy === 'planD') || null;
		const refreshed = this.planner.createSession(previousSession.state, this.$rootScope.version, horizon);
		refreshed.id = previousSession.id;
		refreshed.createdAt = previousSession.createdAt;
		refreshed.notes = previousSession.notes;
		if (customOption) {
			refreshed.options.push(customOption);
		}
		const selected = refreshed.options.find((option) => option.strategy === selectedStrategy) || refreshed.options[0];
		refreshed.selectedOptionId = selected?.id || null;
		const index = this.sessions.indexOf(previousSession);
		if (index !== -1) {
			this.sessions[index] = refreshed;
		}
		this.selectSession(refreshed);
		this.saveSessions();
	}

	public selectCandidate(candidateId: string): void
	{
		if (!this.session || !this.selectedOption || this.selectedOption.cluster.id === candidateId) {
			return;
		}
		const replacement = this.planner.selectCandidate(this.selectedOption, this.session.state, this.$rootScope.version, candidateId);
		const index = this.session.options.indexOf(this.selectedOption);
		if (index !== -1) {
			this.session.options[index] = replacement;
		}
		this.session.selectedOptionId = replacement.id;
		this.selectedOption = replacement;
		this.mapOption = replacement;
		this.customOption = replacement.strategy === 'planD' ? replacement : this.customOption;
		this.syncResourceFilters();
		this.saveSessions();
	}

	public togglePurity(purity: string): void
	{
		this.mapFilters.purities[purity] = !this.mapFilters.purities[purity];
		this.touchMapFilters();
	}

	public toggleResource(item: string): void
	{
		this.mapFilters.resources[item] = !this.mapFilters.resources[item];
		this.touchMapFilters();
	}

	public toggleMapFilter(filter: 'untappedOnly'|'showFactories'|'showRoutes'): void
	{
		this.mapFilters[filter] = !this.mapFilters[filter];
		this.touchMapFilters();
	}

	public fitMapSelection(): void
	{
		this.mapFilters.fitRequest++;
		this.touchMapFilters();
	}

	public markSelected(option: IFactoryPlanOption): void
	{
		if (!this.session) {
			return;
		}
		this.session.selectedOptionId = option.id;
		this.saveSessions();
		Strings.addNotification('Planner', 'Selected "' + option.strategyLabel + '" for the next session.');
	}

	public openAsCalculatorTab(option: IFactoryPlanOption): void
	{
		const storageKey = this.getProductionStorageKey();
		const tabs = this.dataStorageService.loadData(storageKey, []) as IProductionData[];
		tabs.push(angular.copy(option.productionData) as IProductionData);
		this.dataStorageService.saveData(storageKey, tabs);
		Strings.addNotification('Planner', 'Added "' + option.productionData.metadata.name + '" to the calculator.');
		this.$state.go('production', {
			version: this.$rootScope.version,
		});
	}

	public exportRequest(option: IFactoryPlanOption): void
	{
		Strings.downloadFile(
			option.strategyLabel + '-production-request',
			'json',
			JSON.stringify(option.request, null, '\t'),
			'application/json',
		);
	}

	public exportMarkdown(option: IFactoryPlanOption): void
	{
		Strings.downloadFile(
			option.strategyLabel + '-next-plan',
			'md',
			this.planner.exportPlanMarkdown(option),
			'text/markdown',
		);
	}

	public generateCustomPlan(): void
	{
		if (!this.session || !this.customTargetItem) {
			return;
		}
		const rate = Math.max(0.1, Number(this.customTargetRate) || 1);
		this.customTargetRate = rate;
		const option = this.planner.createCustomOption(this.session.state, this.$rootScope.version, this.customTargetItem, rate);
		this.session.options = this.session.options.filter((candidate) => {
			return candidate.strategy !== 'planD';
		});
		this.session.options.push(option);
		this.customOption = option;
		this.selectedOption = option;
		this.mapOption = option;
		this.session.selectedOptionId = option.id;
		this.saveSessions();
		Strings.addNotification('Planner', 'Generated custom Plan D for "' + option.targetDisplay + '".');
	}

	public clearSessions(): void
	{
		if (!confirm('Clear all planner sessions saved in this browser?')) {
			return;
		}
		this.sessions = [];
		this.createStarterSession();
		this.saveSessions();
	}

	public isSelected(option: IFactoryPlanOption): boolean
	{
		return !!this.session && this.session.selectedOptionId === option.id;
	}

	public hasEntries(values: {[key: string]: number}): boolean
	{
		return !!values && Object.keys(values).length > 0;
	}

	public getGoalRemaining(option: IFactoryPlanOption): number
	{
		return option.quantityBasis === 'direct' && option.directRemaining > 0 ? option.directRemaining : option.absoluteRemaining;
	}

	public getPotentialRate(option: IFactoryPlanOption): number
	{
		if (!this.session || !option.targetItems.length) {
			return 0;
		}
		return this.session.state.productionRates[option.targetItems[0]]?.potentialRate || 0;
	}

	public getPotentialMachineCount(option: IFactoryPlanOption): number
	{
		if (!this.session || !option.targetItems.length) {
			return 0;
		}
		return this.session.state.productionRates[option.targetItems[0]]?.machineCount || 0;
	}

	public getEstimatedCompletion(option: IFactoryPlanOption): string
	{
		const rate = this.getPotentialRate(option);
		const remaining = this.getGoalRemaining(option);
		if (remaining <= 0) {
			return 'Ready now';
		}
		if (rate <= 0) {
			return 'No capacity';
		}
		const hours = remaining / rate / 60;
		if (hours < 1) {
			return Math.ceil(hours * 60) + ' min';
		}
		return hours.toFixed(hours < 10 ? 1 : 0) + ' hr';
	}

	public getRateBarWidth(option: IFactoryPlanOption): number
	{
		return Math.max(2, Math.min(100, this.getPotentialRate(option) / Math.max(0.01, option.recommendedRate) * 100));
	}

	public getRateStatus(option: IFactoryPlanOption): string
	{
		const coverage = this.getPotentialRate(option) / Math.max(0.01, option.recommendedRate);
		return coverage >= 1 ? 'on-target' : coverage >= 0.5 ? 'behind' : 'critical';
	}

	public getCurrentPhaseParts(): IProjectAssemblyPartProgress[]
	{
		return this.session?.state.projectAssembly?.parts.filter((part) => {
			return part.directRequiredThroughPhase > 0;
		}) || [];
	}

	public getPartProgress(part: IProjectAssemblyPartProgress): number
	{
		return Math.max(0, Math.min(100, part.currentStock / Math.max(1, part.directRequiredThroughPhase) * 100));
	}

	public getCandidateLabel(candidate: IResourceClusterCandidate): string
	{
		if (!this.selectedOption) {
			return '';
		}
		const index = this.selectedOption.candidateClusters.findIndex((entry) => entry.id === candidate.id);
		return index === -1 ? '' : String.fromCharCode(65 + index);
	}

	public getCandidateScore(candidate: IResourceClusterCandidate): number
	{
		const maximums: {[strategy: string]: number} = {
			planA: 265,
			planB: 260,
			planC: 240,
			planD: 240,
		};
		const maximum = maximums[this.selectedOption?.strategy || 'planC'] || 240;
		return Math.max(0, Math.min(100, Math.round(candidate.score / maximum * 100)));
	}

	public getScorePercent(value: number): number
	{
		return Math.max(0, Math.min(100, Math.round(value * 100)));
	}

	public getPlannerActions(): IPlannerAction[]
	{
		if (!this.selectedOption || !this.session) {
			return [];
		}
		if (this.plannerActionsOption === this.selectedOption && this.plannerActionsSession === this.session) {
			return this.plannerActionsCache;
		}
		const option = this.selectedOption;
		const tappedIds = new Set(this.session.state.tappedNodes.map((node) => node.id));
		const untappedCount = option.selectedResourceNodes.filter((node) => !tappedIds.has(node.id)).length;
		const currentMachines = this.getPotentialMachineCount(option);
		const machineDelta = Math.max(0, option.machineCount - currentMachines);
		const materialShortages = Object.keys(option.buildingCosts).map((item) => {
			return {
				item: item,
				shortage: Math.max(0, option.buildingCosts[item] - (this.session?.state.inventoryTotals[item] || 0)),
			};
		}).filter((entry) => entry.shortage > 0).sort((a, b) => b.shortage - a.shortage);
		this.plannerActionsOption = option;
		this.plannerActionsSession = this.session;
		this.plannerActionsCache = [
			{
				icon: 'fa-map-marker-alt',
				title: untappedCount ? 'Claim ' + untappedCount + ' untapped node' + (untappedCount === 1 ? '' : 's') : 'Reuse tapped resources',
				detail: option.cluster.name,
			},
			{
				icon: 'fa-industry',
				title: machineDelta ? 'Add ' + machineDelta + ' production machines' : 'Existing target capacity found',
				detail: materialShortages.length ? 'Largest material gap: ' + this.formatNumber(materialShortages[0].shortage) + ' ' + this.getItemName(materialShortages[0].item) : 'Build materials are available',
			},
			{
				icon: 'fa-bolt',
				title: 'Reserve ' + this.formatNumber(option.powerMw) + ' MW',
				detail: this.formatNumber(option.recommendedRate) + '/min target capacity',
			},
		];
		return this.plannerActionsCache;
	}

	public isApproximateMap(): boolean
	{
		return !this.session?.state.worldResourceNodes.length || this.session.state.worldResourceNodes[0]?.source === 'catalog';
	}

	public getItemName(item: string): string
	{
		return data.getItemByClassName(item)?.name || item;
	}

	public formatNumber(value: number): string
	{
		if (!isFinite(value)) {
			return '0';
		}
		return value.toFixed(2).replace(/\.?0+$/, '');
	}

	public formatPoint(point: {x: number, y: number, z?: number}): string
	{
		return Math.round(point.x) + ', ' + Math.round(point.y) + (typeof point.z === 'number' ? ', ' + Math.round(point.z) : '');
	}

	public formatDate(value: string): string
	{
		const date = new Date(value);
		if (isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
	}

	public getSessionSummary(session: IPlannerSession): string
	{
		return session.state.objectCount + ' objects' + (session.state.availableRecipes.length ? ' • ' + session.state.availableRecipes.length + ' recipes' : '');
	}

	public getPurityClass(purity: string): string
	{
		return 'planner-node-' + purity;
	}

	public getMapPointStyle(point: {xPercent: number, yPercent: number}): {[key: string]: string}
	{
		return {
			left: point.xPercent + '%',
			top: point.yPercent + '%',
		};
	}

	public getMapMarkerClass(node: IMapOverlayNode): string
	{
		return [
			'planner-world-marker',
			this.getPurityClass(node.purity),
			node.tapped ? 'planner-world-marker-tapped' : 'planner-world-marker-selected',
			this.getMapResourceClass(node.item),
		].join(' ');
	}

	public getMapNodeTitle(node: IMapOverlayNode): string
	{
		return node.itemName + ' - ' + node.purity + ' - ' + this.formatNumber(node.rate) + '/min - ' + this.formatPoint(node) + (node.tapped ? ' - tapped' : ' - selected');
	}

	private getMapResourceClass(item: string): string
	{
		const resourceClasses: {[key: string]: string} = {
			Desc_OreIron_C: 'planner-resource-iron',
			Desc_OreCopper_C: 'planner-resource-copper',
			Desc_Stone_C: 'planner-resource-limestone',
			Desc_Coal_C: 'planner-resource-coal',
			Desc_LiquidOil_C: 'planner-resource-oil',
			Desc_OreGold_C: 'planner-resource-caterium',
			Desc_Sulfur_C: 'planner-resource-sulfur',
			Desc_RawQuartz_C: 'planner-resource-quartz',
			Desc_OreBauxite_C: 'planner-resource-bauxite',
			Desc_NitrogenGas_C: 'planner-resource-nitrogen',
			Desc_SAM_C: 'planner-resource-sam',
			Desc_OreUranium_C: 'planner-resource-uranium',
			Desc_Water_C: 'planner-resource-water',
		};
		return resourceClasses[item] || 'planner-resource-generic';
	}

	public getNodeTitle(node: IWorldResourceNode): string
	{
		return this.getItemName(node.item) + ' - ' + node.purity + ' - ' + node.region + ' - ' + this.formatPoint(node.location);
	}

	private createCustomTargetOptions(): IPlannerTargetOption[]
	{
		const producedItems: {[item: string]: boolean} = {};
		for (const recipe of Object.values(data.getRawData().recipes)) {
			if (!recipe.inMachine || recipe.forBuilding || !recipe.products) {
				continue;
			}
			for (const product of recipe.products) {
				if (data.getRawData().items[product.item]) {
					producedItems[product.item] = true;
				}
			}
		}
		return Object.keys(producedItems).map((item) => {
			return {
				item: item,
				name: this.getItemName(item),
			};
		}).sort((a, b) => {
			return a.name.localeCompare(b.name);
		});
	}

	private addSession(session: IPlannerSession): void
	{
		this.sessions.unshift(session);
		this.sessions = this.sessions.slice(0, 8);
		this.selectSession(session);
		this.saveSessions();
	}

	private loadSessions(): void
	{
		const loaded = this.dataStorageService.loadData(this.storageKey, []) as IPlannerSession[];
		this.sessions = Array.isArray(loaded) ? loaded.map((session) => this.refreshSessionIfNeeded(session)) : [];
		if (!this.sessions.length) {
			this.createStarterSession();
			this.saveSessions();
			return;
		}
		this.selectSession(this.sessions[0]);
	}

	private refreshSessionIfNeeded(session: IPlannerSession): IPlannerSession
	{
		if (!session || !session.state || !session.options || !session.options.length) {
			return session;
		}

		const shouldRefreshMapBounds = session.options.some((option) => {
			return !!option.map && option.map.bounds && option.map.bounds.maxX - option.map.bounds.minX < 700000;
		});
		const missingPlannerState = !session.state.inventoryTotals || !session.state.buildingCounts || !session.state.worldResourceNodes || !session.state.resourceWells;
		const missingDashboardState = !session.planningHorizonHours || session.options.some((option) => {
			return !option.candidateClusters || !option.applicableResources || !option.quantityBasis || !option.map?.candidates;
		});
		if (!shouldRefreshMapBounds && !missingPlannerState && !missingDashboardState) {
			return session;
		}

		const selectedStrategy = session.options.find((option) => {
			return option.id === session.selectedOptionId;
		})?.strategy || null;
		const refreshed = this.planner.createSession(session.state, this.$rootScope.version, session.planningHorizonHours || 10);
		refreshed.id = session.id;
		refreshed.createdAt = session.createdAt;
		refreshed.notes = session.notes || refreshed.notes;
		if (selectedStrategy) {
			const selectedOption = refreshed.options.find((option) => {
				return option.strategy === selectedStrategy;
			});
			refreshed.selectedOptionId = selectedOption ? selectedOption.id : null;
		}
		return refreshed;
	}

	private createStarterSession(): void
	{
		const state: IAgentGameState = this.extractor.createEmptyState(this.$rootScope.version);
		const session = this.planner.createSession(state, this.$rootScope.version, this.planningHorizonHours);
		this.sessions.unshift(session);
		this.selectSession(session);
	}

	private saveSessions(): void
	{
		const serializable = angular.copy(this.sessions) as IPlannerSession[];
		for (const session of serializable) {
			for (const option of session.options) {
				option.result = null;
			}
		}
		this.dataStorageService.saveData(this.storageKey, serializable);
	}

	private getProductionStorageKey(): string
	{
		if (this.$rootScope.version === '1.0') {
			return 'production1';
		}
		if (this.$rootScope.version === '1.0-ficsmas') {
			return 'production-ficsmas';
		}
		return 'tmpProduction';
	}

	private attachSaveInputChangeHandler(): void
	{
		const input = document.getElementById('plannerSaveFile') as HTMLInputElement|null;
		if (!input || this.saveInputElement === input) {
			return;
		}

		this.detachSaveInputChangeHandler();
		this.saveInputElement = input;
		this.saveInputChangeHandler = () => {
			if (input.files && input.files.length) {
				this.tryImport(input);
			}
		};
		input.addEventListener('change', this.saveInputChangeHandler);
	}

	private detachSaveInputChangeHandler(): void
	{
		if (this.saveInputElement && this.saveInputChangeHandler) {
			this.saveInputElement.removeEventListener('change', this.saveInputChangeHandler);
		}
		this.saveInputElement = null;
		this.saveInputChangeHandler = null;
	}

	private syncResourceFilters(): void
	{
		if (!this.selectedOption) {
			return;
		}
		const resources = {...this.mapFilters.resources};
		for (const item of this.selectedOption.applicableResources || []) {
			if (typeof resources[item] === 'undefined') {
				resources[item] = true;
			}
		}
		this.mapFilters = {...this.mapFilters, resources: resources};
	}

	private touchMapFilters(): void
	{
		this.mapFilters = {
			...this.mapFilters,
			purities: {...this.mapFilters.purities},
			resources: {...this.mapFilters.resources},
		};
	}

}
