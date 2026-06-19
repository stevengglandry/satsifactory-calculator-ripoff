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
import {getDefaultBlockedRecipes, isSamResourceConversion} from '@src/AgentPlanner/RecipePolicy';

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

interface ICustomGoalSlot
{
	strategy: 'planD'|'planE';
	item: string;
	rate: number;
	option: IFactoryPlanOption|null;
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
	public readonly horizonOptions = [10, 20, 40, 80];
	public readonly phaseSteps = [1, 2, 3, 4, 5];
	public planningHorizonHours = 40;
	public customGoals: ICustomGoalSlot[] = [];
	public resourceFilterOpen = false;
	public mapFilters = {
		purities: {impure: true, normal: true, pure: true} as {[key: string]: boolean},
		resources: {} as {[key: string]: boolean},
		untappedOnly: false,
		showFactories: true,
		showRoutes: true,
		showRail: true,
		showTrucks: true,
		showDrones: true,
		showHypertubes: true,
		fitRequest: 0,
	};
	public readonly worldMapImage = AppPath.asset('assets/images/planner-biome-map.webp');

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
		this.customGoals = [
			{strategy: 'planD', item: this.customTargetItem, rate: 5, option: null},
			{strategy: 'planE', item: this.customTargetItem, rate: 5, option: null},
		];
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

		this.parseSaveInWorker(file).then((state) => {
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

	private parseSaveInWorker(file: File): Promise<IAgentGameState>
	{
		if (typeof Worker === 'undefined') {
			return Promise.reject(new Error('This browser does not support background save parsing.'));
		}
		return file.arrayBuffer().then((buffer) => new Promise<IAgentGameState>((resolve, reject) => {
			const worker = new Worker(AppPath.asset('assets/planner-save-worker.js'));
			worker.onmessage = (event) => {
				worker.terminate();
				if (event.data?.ok) {
					resolve(event.data.state as IAgentGameState);
				} else {
					reject(new Error(event.data?.error || 'Save worker failed.'));
				}
			};
			worker.onerror = (event) => {
				worker.terminate();
				reject(new Error(event.message || 'Save worker failed.'));
			};
			worker.postMessage({fileName: file.name, gameVersion: this.$rootScope.version, buffer: buffer}, [buffer]);
		}));
	}

	public selectSession(session: IPlannerSession): void
	{
		this.applyLinkedCalculatorChanges(session);
		this.session = session;
		this.planningHorizonHours = session.planningHorizonHours || 40;
		session.recipePolicy = session.recipePolicy || {allowLockedRecipePreview: false, allowSamResourceConversion: false};
		this.customOption = session.options.find((option) => {
			return option.strategy === 'planD';
		}) || null;
		for (const slot of this.customGoals) {
			const option = session.options.find((candidate) => candidate.strategy === slot.strategy) || null;
			slot.option = option;
			if (option) {
				slot.item = option.targetItems[0];
				slot.rate = option.recommendedRate;
			}
		}
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
		const horizon = this.horizonOptions.indexOf(Number(this.planningHorizonHours)) !== -1 ? Number(this.planningHorizonHours) : 40;
		this.planningHorizonHours = horizon;
		const previousSession = this.session;
		const selectedStrategy = this.selectedOption?.strategy || 'planA';
		const customOptions = previousSession.options.filter((option) => option.strategy === 'planD' || option.strategy === 'planE');
		const refreshed = this.planner.createSession(previousSession.state, this.$rootScope.version, horizon);
		refreshed.id = previousSession.id;
		refreshed.createdAt = previousSession.createdAt;
		refreshed.notes = previousSession.notes;
		refreshed.options.push(...customOptions);
		refreshed.recipePolicy = previousSession.recipePolicy || refreshed.recipePolicy;
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
		const customSlot = this.customGoals.find((slot) => slot.strategy === replacement.strategy);
		if (customSlot) {
			customSlot.option = replacement;
		}
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

	public toggleMapFilter(filter: 'untappedOnly'|'showFactories'|'showRoutes'|'showRail'|'showTrucks'|'showDrones'|'showHypertubes'): void
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
		const productionData = angular.copy(option.productionData) as IProductionData;
		productionData.metadata.plannerLink = {
			plannerPlanId: option.id,
			saveSnapshotId: this.session?.id || '',
			goalSlotId: option.strategy,
			revision: 1,
		};
		const existingIndex = tabs.findIndex((tab) => tab.metadata?.plannerLink?.plannerPlanId === option.id);
		if (existingIndex === -1) {
			tabs.push(productionData);
		} else {
			tabs[existingIndex] = productionData;
		}
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

	public generateCustomPlan(slot?: ICustomGoalSlot): void
	{
		slot = slot || this.customGoals[0];
		if (!this.session || !slot || !slot.item) {
			return;
		}
		const rate = Math.max(0.1, Number(slot.rate) || 1);
		slot.rate = rate;
		const option = this.planner.createCustomOption(this.session.state, this.$rootScope.version, slot.item, rate, slot.strategy);
		this.session.options = this.session.options.filter((candidate) => {
			return candidate.strategy !== slot?.strategy;
		});
		this.session.options.push(option);
		slot.option = option;
		if (slot.strategy === 'planD') {
			this.customOption = option;
		}
		this.selectedOption = option;
		this.mapOption = option;
		this.session.selectedOptionId = option.id;
		this.saveSessions();
		Strings.addNotification('Planner', 'Generated ' + option.planLabel + ' for "' + option.targetDisplay + '".');
	}

	public adjustCustomRate(slot: ICustomGoalSlot, delta: number): void
	{
		slot.rate = Math.max(0.1, Math.round((Number(slot.rate || 0) + delta) * 10) / 10);
	}

	public adjustOptionRate(option: IFactoryPlanOption, delta: number, event?: Event): void
	{
		event?.stopPropagation();
		if (!this.session) {
			return;
		}
		const replacement = this.planner.retargetOption(option, this.session.state, this.$rootScope.version, option.recommendedRate + delta);
		if (this.session.recipePolicy.allowSamResourceConversion) {
			replacement.productionData.request.blockedRecipes = replacement.productionData.request.blockedRecipes.filter((className) => !isSamResourceConversion(className));
		}
		if (this.session.recipePolicy.allowLockedRecipePreview) {
			replacement.productionData.request.allowedAlternateRecipes = data.getAlternateRecipes().filter((recipe) => !isSamResourceConversion(recipe)).map((recipe) => recipe.className);
		}
		const index = this.session.options.indexOf(option);
		if (index !== -1) {
			this.session.options[index] = replacement;
		}
		this.selectedOption = replacement;
		this.mapOption = replacement;
		this.session.selectedOptionId = replacement.id;
		this.saveSessions();
	}

	public toggleRecipePolicy(policy: 'allowLockedRecipePreview'|'allowSamResourceConversion'): void
	{
		if (!this.session) {
			return;
		}
		this.session.recipePolicy[policy] = !this.session.recipePolicy[policy];
		for (const option of this.session.options) {
			const request = option.productionData.request;
			if (this.session.recipePolicy.allowSamResourceConversion) {
				request.blockedRecipes = request.blockedRecipes.filter((className) => !isSamResourceConversion(className));
			} else {
				request.blockedRecipes = Array.from(new Set([...request.blockedRecipes, ...getDefaultBlockedRecipes()]));
			}
			if (policy === 'allowLockedRecipePreview') {
				request.allowedAlternateRecipes = this.session.recipePolicy.allowLockedRecipePreview
					? data.getAlternateRecipes().filter((recipe) => !isSamResourceConversion(recipe)).map((recipe) => recipe.className)
					: request.allowedAlternateRecipes.filter((className) => this.session?.state.availableRecipes.indexOf(className) !== -1);
			}
			option.request = {...option.request, ...angular.copy(request), gameVersion: option.request.gameVersion};
		}
		this.saveSessions();
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

	public getEndgameParts(): IProjectAssemblyPartProgress[]
	{
		return this.session?.state.projectAssembly?.parts || [];
	}

	public getCapacityBarWidth(part: IProjectAssemblyPartProgress): number
	{
		return Math.max(2, Math.min(100, part.currentRate / Math.max(0.01, part.idealRate) * 100));
	}

	public getCapacityStatus(part: IProjectAssemblyPartProgress): string
	{
		const coverage = part.currentRate / Math.max(0.01, part.idealRate);
		return coverage >= 1 ? 'on-target' : coverage >= 0.5 ? 'behind' : 'critical';
	}

	public getPartEstimate(part: IProjectAssemblyPartProgress): string
	{
		if (part.absoluteRemaining <= 0) {
			return 'Complete';
		}
		return part.estimatedHours === null ? 'No capacity' : this.formatNumber(part.estimatedHours) + ' hr';
	}

	public getGoalKind(option: IFactoryPlanOption): string
	{
		if (option.strategy === 'planA') {
			return 'Immediate progress';
		}
		if (option.strategy === 'planB') {
			return 'Capacity gap';
		}
		if (option.strategy === 'planC') {
			return 'Endgame bottleneck';
		}
		return 'Custom goal';
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
		this.loadSessionsFromIndexedDb().then((indexedSessions) => {
			if (!indexedSessions.length || indexedSessions[0]?.createdAt === this.sessions[0]?.createdAt) {
				return;
			}
			this.$timeout(0).then(() => {
				this.sessions = indexedSessions.map((session) => this.refreshSessionIfNeeded(session));
				this.selectSession(this.sessions[0]);
			});
		}).catch(() => undefined);
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
		const missingDashboardState = !session.recipePolicy
			|| !session.planningHorizonHours
			|| !!session.state.projectAssembly?.parts.some((part) => typeof part.idealRate !== 'number')
			|| session.options.some((option) => {
			return !option.candidateClusters || !option.applicableResources || !option.quantityBasis || !option.map?.candidates;
			});
		if (!shouldRefreshMapBounds && !missingPlannerState && !missingDashboardState) {
			return session;
		}

		const selectedStrategy = session.options.find((option) => {
			return option.id === session.selectedOptionId;
		})?.strategy || null;
		const refreshed = this.planner.createSession(session.state, this.$rootScope.version, session.planningHorizonHours || 40);
		refreshed.id = session.id;
		refreshed.createdAt = session.createdAt;
		refreshed.notes = session.notes || refreshed.notes;
		refreshed.recipePolicy = session.recipePolicy || refreshed.recipePolicy;
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
		this.dataStorageService.saveData(this.storageKey, serializable.slice(0, 2));
		this.saveSessionsToIndexedDb(serializable).catch(() => undefined);
	}

	private openPlannerDatabase(): Promise<IDBDatabase>
	{
		return new Promise((resolve, reject) => {
			if (!window.indexedDB) {
				reject(new Error('IndexedDB is unavailable.'));
				return;
			}
			const request = window.indexedDB.open('satisfactory-tools-planner', 1);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains('sessions')) {
					database.createObjectStore('sessions');
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('Could not open planner storage.'));
		});
	}

	private saveSessionsToIndexedDb(sessions: IPlannerSession[]): Promise<void>
	{
		return this.openPlannerDatabase().then((database) => new Promise<void>((resolve, reject) => {
			const transaction = database.transaction('sessions', 'readwrite');
			transaction.objectStore('sessions').put(sessions, this.storageKey);
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
			transaction.onerror = () => reject(transaction.error || new Error('Could not save planner sessions.'));
		}));
	}

	private loadSessionsFromIndexedDb(): Promise<IPlannerSession[]>
	{
		return this.openPlannerDatabase().then((database) => new Promise<IPlannerSession[]>((resolve, reject) => {
			const request = database.transaction('sessions', 'readonly').objectStore('sessions').get(this.storageKey);
			request.onsuccess = () => {
				database.close();
				resolve(Array.isArray(request.result) ? request.result : []);
			};
			request.onerror = () => reject(request.error || new Error('Could not load planner sessions.'));
		}));
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

	private applyLinkedCalculatorChanges(session: IPlannerSession): void
	{
		const links = this.dataStorageService.loadData('plannerLinkedPlans-' + this.$rootScope.version, {}) as {[planId: string]: {request: any, revision: number}};
		for (const option of session.options || []) {
			const link = links[option.id];
			if (!link || !link.request) {
				continue;
			}
			option.productionData.request = angular.copy(link.request);
			const production = link.request.production?.[0];
			if (production && production.item === option.targetItems[0]) {
				option.recommendedRate = Math.max(0.1, Number(production.amount) || option.recommendedRate);
			}
		}
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
