import {Constants} from '@src/Constants';
import data, {Data} from '@src/Data/Data';
import {Formula} from '@src/Formula';
import {LocalProductionSolver} from '@src/Solver/LocalProductionSolver';
import {
	IAgentGameState,
	IFactoryPlanOption,
	IMapOverlay,
	IMapOverlayNode,
	IMapPoint,
	IPlannerSession,
	IResourceClusterCandidate,
	IWorldResourceNode,
	PlannerStrategyId,
	ResourcePurity,
} from '@src/AgentPlanner/Types';
import {WORLD_RESOURCE_NODES} from '@src/AgentPlanner/ResourceNodeCatalog';
import {IProjectAssemblyPartProgress, IProjectAssemblyTarget, PROJECT_ASSEMBLY_REQUIREMENTS} from '@src/AgentPlanner/ProjectAssembly';
import {IProductionData, IProductionDataApiRequest, IProductionDataRequest} from '@src/Tools/Production/IProductionData';
import {ProductionResultFactory} from '@src/Tools/Production/Result/ProductionResultFactory';
import {IRecipeSchema} from '@src/Schema/IRecipeSchema';
import {IMinerSchema} from '@src/Schema/IMinerSchema';
import {getDefaultBlockedRecipes, isSamResourceConversion} from '@src/AgentPlanner/RecipePolicy';

interface IStrategyConfig
{
	id: PlannerStrategyId;
	label: string;
	summary: string;
	radius: number;
	targetItems: string[];
	type: string;
	amount: number;
	ratio: number;
	planLabel: 'Plan A'|'Plan B'|'Plan C'|'Plan D'|'Plan E';
	targetReason: string;
	directRemaining: number;
	absoluteRemaining: number;
	recommendedRate: number;
	quantityBasis: 'direct'|'absolute'|'custom';
	confidence: 'high'|'inferred'|'unknown';
}

function copyPlain<T>(value: T): T
{
	return JSON.parse(JSON.stringify(value)) as T;
}

export class FactoryPlanner
{
	private readonly infrastructureTargets: Array<{item: string, stockGoal: number}> = [
		{item: 'Desc_ModularFrame_C', stockGoal: 250},
		{item: 'Desc_SteelPlateReinforced_C', stockGoal: 300},
		{item: 'Desc_Motor_C', stockGoal: 120},
		{item: 'Desc_Computer_C', stockGoal: 75},
		{item: 'Desc_AluminumCasing_C', stockGoal: 500},
	];

	private readonly mapBounds = {
		minX: -324600,
		maxX: 425300,
		minY: -375000,
		maxY: 375000,
	};

	private readonly projectPartOrder: string[] = [
		'Desc_SpaceElevatorPart_1_C',
		'Desc_SpaceElevatorPart_2_C',
		'Desc_SpaceElevatorPart_3_C',
		'Desc_SpaceElevatorPart_4_C',
		'Desc_SpaceElevatorPart_5_C',
		'Desc_SpaceElevatorPart_6_C',
		'Desc_SpaceElevatorPart_7_C',
		'Desc_SpaceElevatorPart_8_C',
		'Desc_SpaceElevatorPart_9_C',
		'Desc_SpaceElevatorPart_10_C',
		'Desc_SpaceElevatorPart_11_C',
		'Desc_SpaceElevatorPart_12_C',
	];

	public createSession(state: IAgentGameState, version: string, planningHorizonHours: number = 40): IPlannerSession
	{
		state = this.normalizeState(state);
		planningHorizonHours = this.normalizePlanningHorizon(planningHorizonHours);
		this.applyCapacityTargets(state, planningHorizonHours);
		const targets = this.chooseProjectAssemblyTargets(state);
		const configs = targets.map((target, index) => {
			return this.createStrategyConfig(target, index, planningHorizonHours);
		});

		const options = configs.map((config) => {
			return this.createOption(config, state, version);
		});

		return {
			id: this.createUniqueId('session'),
			saveName: state.saveName,
			createdAt: new Date().toISOString(),
			state: state,
			options: options,
			planningHorizonHours: planningHorizonHours,
			recipePolicy: {
				allowLockedRecipePreview: false,
				allowSamResourceConversion: false,
			},
			selectedOptionId: null,
			notes: [
				'Plans use save-derived resource nodes when available and the checked-in catalog only as a fallback.',
				'Project Assembly targets use direct phase requirements and absolute cumulative quotas.',
				'Route data is a proximity scoring bonus; full train or truck pathfinding is not used.',
			],
		};
	}

	public exportPlanMarkdown(option: IFactoryPlanOption): string
	{
		const lines: string[] = [];
		lines.push('# ' + option.planLabel + ': ' + option.targetDisplay);
		lines.push('');
		lines.push(option.summary);
		lines.push('');
		lines.push('- Reason: ' + option.targetReason);
		lines.push('- Recommended rate: ' + option.recommendedRate + '/min');
		lines.push('- Direct remaining: ' + option.directRemaining);
		lines.push('- Absolute quota remaining: ' + option.absoluteRemaining);
		lines.push('- Confidence: ' + option.confidence);
		lines.push('');
		lines.push('## Target');
		for (const target of option.targetItems) {
			lines.push('- ' + this.getItemName(target));
		}
		lines.push('');
		lines.push('## Outpost');
		lines.push('- Cluster: ' + option.cluster.name);
		lines.push('- Center: ' + this.formatPoint(option.cluster.center));
		lines.push('- Score: ' + option.cluster.score.toFixed(2));
		lines.push('');
		lines.push('## Resource Nodes');
		for (const node of option.cluster.nodes) {
			lines.push('- ' + this.getItemName(node.item) + ' - ' + node.purity + ' - ' + node.region + ' - ' + this.formatPoint(node.location) + ' - ' + this.getNodeRate(node).toFixed(1) + '/min');
		}
		lines.push('');
		lines.push('## Summary');
		lines.push('- Machines: ' + option.machineCount);
		lines.push('- Power: ' + option.powerMw.toFixed(1) + ' MW');
		lines.push('');
		lines.push('## Raw Resource Use');
		for (const item of Object.keys(option.rawResourceUse)) {
			lines.push('- ' + this.getItemName(item) + ': ' + option.rawResourceUse[item].toFixed(2) + '/min');
		}
		lines.push('');
		lines.push('## Build Materials');
		for (const item of Object.keys(option.buildingCosts)) {
			lines.push('- ' + this.getItemName(item) + ': ' + option.buildingCosts[item]);
		}
		if (option.warnings.length) {
			lines.push('');
			lines.push('## Warnings');
			for (const warning of option.warnings) {
				lines.push('- ' + warning);
			}
		}
		return lines.join('\n');
	}

	public createCustomOption(state: IAgentGameState, version: string, item: string, rate: number, strategy: 'planD'|'planE' = 'planD'): IFactoryPlanOption
	{
		state = this.normalizeState(state);
		const clampedRate = Math.max(0.1, Math.min(9999, rate || 1));
		const planLabel = strategy === 'planE' ? 'Plan E' : 'Plan D';
		const config: IStrategyConfig = {
			id: strategy,
			label: planLabel + ': ' + this.getItemName(item),
			summary: 'Custom target selected by the user.',
			radius: 75000,
			targetItems: [item],
			type: Constants.PRODUCTION_TYPE.PER_MINUTE,
			amount: clampedRate,
			ratio: 100,
			planLabel: planLabel,
			targetReason: 'Custom wildcard target and production rate.',
			directRemaining: 0,
			absoluteRemaining: 0,
			recommendedRate: clampedRate,
			confidence: 'high',
			quantityBasis: 'custom',
		};
		return this.createOption(config, state, version);
	}

	public selectCandidate(option: IFactoryPlanOption, state: IAgentGameState, version: string, candidateId: string): IFactoryPlanOption
	{
		state = this.normalizeState(state);
		const config: IStrategyConfig = {
			id: option.strategy,
			label: option.strategyLabel,
			summary: option.summary,
			radius: option.strategy === 'planA' ? 55000 : option.strategy === 'planB' ? 85000 : option.strategy === 'planD' ? 75000 : 70000,
			targetItems: option.targetItems,
			type: Constants.PRODUCTION_TYPE.PER_MINUTE,
			amount: option.recommendedRate,
			ratio: 100,
			planLabel: option.planLabel as IStrategyConfig['planLabel'],
			targetReason: option.targetReason,
			directRemaining: option.directRemaining,
			absoluteRemaining: option.absoluteRemaining,
			recommendedRate: option.recommendedRate,
			quantityBasis: option.quantityBasis,
			confidence: option.confidence,
		};
		const requiredResources = this.getRequiredRawResources(config.targetItems, state);
		const candidates = this.chooseClusters(config, requiredResources, state);
		const cluster = candidates.find((candidate) => candidate.id === candidateId) || candidates[0];
		return this.createOption(config, state, version, cluster, candidates);
	}

	public retargetOption(option: IFactoryPlanOption, state: IAgentGameState, version: string, rate: number): IFactoryPlanOption
	{
		state = this.normalizeState(state);
		const clampedRate = Math.max(0.1, Math.min(9999, Math.round(rate * 10) / 10));
		const config: IStrategyConfig = {
			id: option.strategy,
			label: option.strategyLabel,
			summary: option.summary,
			radius: option.strategy === 'planA' ? 55000 : option.strategy === 'planB' ? 85000 : option.strategy === 'planD' || option.strategy === 'planE' ? 75000 : 70000,
			targetItems: option.targetItems,
			type: Constants.PRODUCTION_TYPE.PER_MINUTE,
			amount: clampedRate,
			ratio: 100,
			planLabel: option.planLabel as IStrategyConfig['planLabel'],
			targetReason: option.targetReason,
			directRemaining: option.directRemaining,
			absoluteRemaining: option.absoluteRemaining,
			recommendedRate: clampedRate,
			quantityBasis: option.quantityBasis,
			confidence: option.confidence,
		};
		return this.createOption(config, state, version, option.cluster, option.candidateClusters);
	}

	private createOption(
		config: IStrategyConfig,
		state: IAgentGameState,
		version: string,
		forcedCluster?: IResourceClusterCandidate,
		preparedCandidates?: IResourceClusterCandidate[],
	): IFactoryPlanOption
	{
		const requiredResources = this.getRequiredRawResources(config.targetItems, state);
		const candidates = preparedCandidates || this.chooseClusters(config, requiredResources, state);
		const cluster = forcedCluster || candidates[0];
		const request = this.createProductionRequest(config, state, cluster, version);
		const productionData = this.createProductionData(config, request, version);
		const warnings = copyPlain(state.notes);
		let result = null;
		let machineCount = 0;
		let powerMw = 0;
		let rawResourceUse: {[key: string]: number} = {};
		let buildingCosts: {[key: string]: number} = {};

		try {
			const solverResponse = LocalProductionSolver.solve(request);
			if (!Object.keys(solverResponse).length) {
				warnings.push('The solver returned no production graph for this option.');
			} else {
				result = new ProductionResultFactory().create(request, solverResponse, data.getRawData());
				machineCount = result.details.buildings.amount;
				powerMw = result.details.power.total.average || 0;
				rawResourceUse = this.getRawResourceUse(result.details.rawResources);
				buildingCosts = result.details.buildings.resources;
			}
		} catch (e) {
			warnings.push('No feasible production plan was found with the selected resources.');
		}

		if (cluster.missingResources.length) {
			warnings.push('The selected cluster needed global fallback nodes for: ' + cluster.missingResources.map((item) => this.getItemName(item)).join(', ') + '.');
		}

		return {
			id: this.createUniqueId(config.id),
			strategy: config.id,
			planLabel: config.planLabel,
			strategyLabel: config.label,
			summary: config.summary,
			targetReason: config.targetReason,
			targetItems: config.targetItems,
			targetDisplay: config.targetItems.map((item) => this.getItemName(item)).join(', '),
			directRemaining: config.directRemaining,
			absoluteRemaining: config.absoluteRemaining,
			recommendedRate: config.recommendedRate,
			quantityBasis: config.quantityBasis,
			confidence: config.confidence,
			applicableResources: requiredResources,
			selectedResourceNodes: cluster.nodes,
			factoryArea: {
				id: cluster.id + '-area',
				name: cluster.name,
				center: cluster.center,
				buildingCount: 0,
				radius: Math.max(8000, this.averageDistance(cluster.center, cluster.nodes)),
			},
			scoreDetails: {
				coverage: cluster.coverageScore,
				throughput: cluster.throughputScore,
				logistics: cluster.logisticsScore,
				route: cluster.routeScore,
				occupiedArea: cluster.occupiedAreaScore,
				player: cluster.playerScore,
				tappedPenalty: cluster.tappedPenalty,
			},
			cluster: cluster,
			candidateClusters: candidates,
			request: request,
			productionData: productionData,
			result: result,
			powerMw: powerMw,
			machineCount: machineCount,
			rawResourceUse: rawResourceUse,
			buildingCosts: buildingCosts,
			warnings: warnings,
			map: this.createMapOverlay(state.worldResourceNodes, cluster.nodes, state.tappedNodes, candidates, cluster, requiredResources),
		};
	}

	private chooseProjectAssemblyTargets(state: IAgentGameState): IProjectAssemblyTarget[]
	{
		const progressParts = this.getProjectAssemblyParts(state).filter((part) => {
			return !!this.getPreferredRecipeForItem(part.item, state) && this.isAutoProjectPartEligible(part, state);
		});
		if (!progressParts.length) {
			const fallback = this.createFallbackProjectPart(state, this.projectPartOrder[0]);
			return [
				this.createProjectTarget(fallback, 'Plan A', 'Next Project Assembly part available from base recipe data.'),
				this.createProjectTarget(this.createFallbackProjectPart(state, this.projectPartOrder[1]), 'Plan B', 'Next alternate Project Assembly target.'),
				this.createProjectTarget(this.createFallbackProjectPart(state, this.projectPartOrder[2]), 'Plan C', 'Next backup Project Assembly target.'),
			];
		}

		const selected: IProjectAssemblyTarget[] = [];
		const used: {[item: string]: boolean} = {};
		const milestoneTarget = this.getActiveMilestoneTarget(state);
		const directTarget = progressParts.find((part) => {
			return part.directRemaining > 0;
		}) || progressParts.find((part) => {
			return part.absoluteRemaining > 0;
		}) || progressParts[0];
		if (milestoneTarget) {
			selected.push({...milestoneTarget, planLabel: 'Plan A'});
			used[milestoneTarget.item] = true;
		} else {
			selected.push(this.createProjectTarget(directTarget, 'Plan A', 'Next direct Space Elevator delivery needed for phase progression.'));
			used[directTarget.item] = true;
		}

		const downstreamTargets = progressParts.filter((part) => {
			return !used[part.item] && part.absoluteRemaining > 0 && part.capacityGap > 0;
		}).sort((partA, partB) => {
			return this.compareRunwayPriority(partA, partB);
		});
		const downstreamTarget = downstreamTargets[0] || progressParts.find((part) => {
			return !used[part.item];
		}) || directTarget;
		selected.push(this.createProjectTarget(downstreamTarget, 'Plan B', 'Largest positive endgame runway gap not covered by Plan A.'));
		used[downstreamTarget.item] = true;

		const catchupTargets = progressParts.filter((part) => {
			return !used[part.item] && part.absoluteRemaining > 0;
		}).sort((partA, partB) => {
			const directA = partA.directRemaining > 0 ? 1 : 0;
			const directB = partB.directRemaining > 0 ? 1 : 0;
			if (directA !== directB) {
				return directB - directA;
			}
			const rateA = partA.currentRate > 0 ? 1 : 0;
			const rateB = partB.currentRate > 0 ? 1 : 0;
			if (rateA !== rateB) {
				return rateA - rateB;
			}
			return this.projectPartOrder.indexOf(partA.item) - this.projectPartOrder.indexOf(partB.item);
		});
		const catchupTarget = catchupTargets[0] || progressParts.find((part) => {
			return !used[part.item];
		}) || directTarget;
		selected.push(this.createProjectTarget(catchupTarget, 'Plan C', 'Useful downstream or catch-up Project Assembly target not covered by Plans A or B.'));

		return selected;
	}

	private compareRunwayPriority(partA: IProjectAssemblyPartProgress, partB: IProjectAssemblyPartProgress): number
	{
		const directA = partA.directRemaining > 0 ? 1 : 0;
		const directB = partB.directRemaining > 0 ? 1 : 0;
		if (directA !== directB) {
			return directB - directA;
		}
		const gapDiff = partB.capacityGap - partA.capacityGap;
		if (Math.abs(gapDiff) > 0.001) {
			return gapDiff;
		}
		const absoluteDiff = partB.absoluteRemaining - partA.absoluteRemaining;
		if (Math.abs(absoluteDiff) > 0.001) {
			return absoluteDiff;
		}
		const phaseA = partA.nextPhase || Number.MAX_SAFE_INTEGER;
		const phaseB = partB.nextPhase || Number.MAX_SAFE_INTEGER;
		if (phaseA !== phaseB) {
			return phaseA - phaseB;
		}
		return this.projectPartOrder.indexOf(partA.item) - this.projectPartOrder.indexOf(partB.item);
	}

	private getActiveMilestoneTarget(state: IAgentGameState): IProjectAssemblyTarget|null
	{
		if (!state.activeSchematic || state.unlockedSchematics.indexOf(state.activeSchematic) !== -1) {
			return null;
		}
		const schematic = data.getRawData().schematics[state.activeSchematic];
		if (!schematic || !schematic.cost?.length) {
			return null;
		}
		const gaps = schematic.cost.map((cost) => ({
			item: cost.item,
			remaining: Math.max(0, cost.amount - (state.inventoryTotals[cost.item] || 0)),
			currentRate: state.productionRates[cost.item]?.potentialRate || 0,
		})).filter((entry) => entry.remaining > 0 && !!this.getPreferredRecipeForItem(entry.item, state)).sort((a, b) => {
			const hoursA = a.currentRate > 0 ? a.remaining / a.currentRate : Number.MAX_SAFE_INTEGER;
			const hoursB = b.currentRate > 0 ? b.remaining / b.currentRate : Number.MAX_SAFE_INTEGER;
			return hoursB - hoursA;
		});
		if (!gaps.length) {
			return null;
		}
		const gap = gaps[0];
		return {
			item: gap.item,
			planLabel: 'Plan A',
			reason: 'Active milestone blocker for ' + schematic.name + '.',
			directRemaining: gap.remaining,
			absoluteRemaining: gap.remaining,
			recommendedRate: 0,
			currentRate: gap.currentRate,
			confidence: 'high',
		};
	}

	private createStrategyConfig(target: IProjectAssemblyTarget, index: number, planningHorizonHours: number): IStrategyConfig
	{
		const ids: PlannerStrategyId[] = ['planA', 'planB', 'planC'];
		const radius = index === 0 ? 55000 : index === 1 ? 85000 : 70000;
		const remaining = index === 0 && target.directRemaining > 0 ? target.directRemaining : target.absoluteRemaining;
		const idealRate = this.getRecommendedRate(remaining, planningHorizonHours);
		const additionalRate = Math.max(0.1, Math.round(Math.max(0, idealRate - target.currentRate) * 100) / 100);
		return {
			id: ids[index] || 'planC',
			label: target.planLabel + ': ' + this.getItemName(target.item),
			summary: target.reason,
			radius: radius,
			targetItems: [target.item],
			type: Constants.PRODUCTION_TYPE.PER_MINUTE,
			amount: additionalRate,
			ratio: 100,
			planLabel: target.planLabel,
			targetReason: target.reason,
			directRemaining: target.directRemaining,
			absoluteRemaining: target.absoluteRemaining,
			recommendedRate: additionalRate,
			quantityBasis: index === 0 && target.directRemaining > 0 ? 'direct' : 'absolute',
			confidence: target.confidence,
		};
	}

	private getProjectAssemblyParts(state: IAgentGameState): IProjectAssemblyPartProgress[]
	{
		if (state.projectAssembly && state.projectAssembly.parts && state.projectAssembly.parts.length) {
			return state.projectAssembly.parts.slice().sort((partA, partB) => {
				return this.projectPartOrder.indexOf(partA.item) - this.projectPartOrder.indexOf(partB.item);
			});
		}

		return PROJECT_ASSEMBLY_REQUIREMENTS.map((requirement) => {
			return this.createFallbackProjectPart(state, requirement.item);
		});
	}

	private createFallbackProjectPart(state: IAgentGameState, item: string): IProjectAssemblyPartProgress
	{
		const requirement = PROJECT_ASSEMBLY_REQUIREMENTS.find((candidate) => {
			return candidate.item === item;
		}) || PROJECT_ASSEMBLY_REQUIREMENTS[0];
		const currentStock = this.getStock(requirement.item, state);
		const directRequired = requirement.phaseDeliveries.reduce((sum, amount) => {
			return sum + amount;
		}, 0);
		return {
			item: requirement.item,
			name: requirement.name,
			currentStock: currentStock,
			currentRate: state.productionRates?.[requirement.item]?.potentialRate || 0,
			directRequiredThroughPhase: directRequired,
			directRemaining: Math.max(0, directRequired - currentStock),
			absoluteTotal: requirement.absoluteTotal,
			absoluteRemaining: Math.max(0, requirement.absoluteTotal - currentStock),
			idealRate: 0,
			capacityGap: 0,
			estimatedHours: null,
			nextPhase: null,
			confidence: 'unknown',
		};
	}

	private createProjectTarget(part: IProjectAssemblyPartProgress, planLabel: 'Plan A'|'Plan B'|'Plan C', reason: string): IProjectAssemblyTarget
	{
		const remaining = Math.max(part.directRemaining, Math.min(part.absoluteRemaining, part.directRemaining || part.absoluteRemaining));
		return {
			item: part.item,
			planLabel: planLabel,
			reason: reason,
			directRemaining: part.directRemaining,
			absoluteRemaining: part.absoluteRemaining,
			recommendedRate: this.getRecommendedRate(remaining),
			currentRate: part.currentRate,
			confidence: part.confidence,
		};
	}

	private isAutoProjectPartEligible(part: IProjectAssemblyPartProgress, state: IAgentGameState): boolean
	{
		if (part.directRemaining > 0 || part.capacityGap > 0 || part.currentStock > 0 || part.currentRate > 0) {
			return true;
		}
		if (this.hasUnlockedRecipeForItem(part.item, state)) {
			return true;
		}
		const currentPhase = state.projectAssembly?.currentPhase || 1;
		const firstDeliveryPhase = this.getFirstDeliveryPhase(part.item);
		return firstDeliveryPhase !== null && firstDeliveryPhase <= currentPhase + 1;
	}

	private getFirstDeliveryPhase(item: string): number|null
	{
		const requirement = PROJECT_ASSEMBLY_REQUIREMENTS.find((candidate) => {
			return candidate.item === item;
		});
		if (!requirement) {
			return null;
		}
		const phaseIndex = requirement.phaseDeliveries.findIndex((amount) => {
			return amount > 0;
		});
		return phaseIndex === -1 ? null : phaseIndex + 1;
	}

	private getRecommendedRate(remaining: number, planningHorizonHours: number = 10): number
	{
		if (remaining <= 0) {
			return 0.1;
		}
		return Math.max(0.1, Math.round(remaining / (this.normalizePlanningHorizon(planningHorizonHours) * 60) * 100) / 100);
	}

	private normalizePlanningHorizon(value: number): number
	{
		return [10, 20, 40, 80].indexOf(Number(value)) !== -1 ? Number(value) : 40;
	}

	private applyCapacityTargets(state: IAgentGameState, planningHorizonHours: number): void
	{
		if (!state.projectAssembly) {
			return;
		}
		state.projectAssembly.planningHorizonHours = planningHorizonHours;
		for (const part of state.projectAssembly.parts) {
			part.idealRate = this.getRecommendedRate(part.absoluteRemaining, planningHorizonHours);
			part.capacityGap = Math.max(0, Math.round((part.idealRate - part.currentRate) * 100) / 100);
			part.estimatedHours = part.currentRate > 0 ? Math.round(part.absoluteRemaining / part.currentRate * 10 / 60) / 10 : null;
		}
	}

	private hasUnlockedRecipeForItem(item: string, state: IAgentGameState): boolean
	{
		return Object.values(data.getRawData().recipes).some((recipe) => {
			if (!recipe.inMachine || recipe.forBuilding || !recipe.producedIn.length || recipe.alternate) {
				return false;
			}
			if (state.availableRecipes.indexOf(recipe.className) === -1) {
				return false;
			}
			return recipe.products.some((product) => {
				return product.item === item;
			});
		});
	}

	private chooseInfrastructureTarget(state: IAgentGameState): string
	{
		const candidates = this.infrastructureTargets.filter((candidate) => {
			return !!this.getPreferredRecipeForItem(candidate.item, state);
		});
		if (!candidates.length) {
			return 'Desc_IronPlateReinforced_C';
		}

		candidates.sort((candidateA, candidateB) => {
			return this.getInfrastructureCoverage(candidateA.item, candidateA.stockGoal, state) - this.getInfrastructureCoverage(candidateB.item, candidateB.stockGoal, state);
		});

		return candidates[0].item;
	}

	private getRequiredRawResources(targetItems: string[], state: IAgentGameState): string[]
	{
		const result: {[key: string]: boolean} = {};
		for (const item of targetItems) {
			this.collectRawResources(item, state, result, {});
		}
		return Object.keys(result);
	}

	private collectRawResources(item: string, state: IAgentGameState, result: {[key: string]: boolean}, visited: {[key: string]: boolean}): void
	{
		if (visited[item]) {
			return;
		}
		visited[item] = true;

		if (item in data.getRawData().resources) {
			result[item] = true;
			return;
		}

		const recipe = this.getPreferredRecipeForItem(item, state);
		if (!recipe) {
			return;
		}

		for (const ingredient of recipe.ingredients) {
			this.collectRawResources(ingredient.item, state, result, visited);
		}
	}

	private getPreferredRecipeForItem(item: string, state: IAgentGameState): IRecipeSchema|null
	{
		const recipes = Object.values(data.getRawData().recipes).filter((recipe) => {
			if (!recipe.inMachine || recipe.forBuilding || !recipe.producedIn.length || recipe.alternate) {
				return false;
			}
			return recipe.products.some((product) => {
				return product.item === item;
			});
		}).sort((recipeA, recipeB) => {
			return recipeA.name.localeCompare(recipeB.name);
		});

		if (!recipes.length) {
			return null;
		}

		if (!state.availableRecipes.length) {
			return recipes[0];
		}

		for (const recipe of recipes) {
			if (state.availableRecipes.indexOf(recipe.className) !== -1) {
				return recipe;
			}
		}

		return recipes[0];
	}

	private chooseClusters(config: IStrategyConfig, requiredResources: string[], state: IAgentGameState): IResourceClusterCandidate[]
	{
		const candidates: IResourceClusterCandidate[] = [];
		const worldNodes = state.worldResourceNodes.length ? state.worldResourceNodes : WORLD_RESOURCE_NODES;
		for (const centerNode of worldNodes) {
			candidates.push(this.buildClusterCandidate(config, centerNode, requiredResources, state));
		}

		candidates.sort((a, b) => {
			return b.score - a.score;
		});

		const selected: IResourceClusterCandidate[] = [];
		for (const candidate of candidates) {
			if (selected.every((existing) => this.distance(existing.center, candidate.center) >= Math.max(25000, config.radius * 0.35))) {
				selected.push(candidate);
			}
			if (selected.length === 3) {
				break;
			}
		}
		return selected.length ? selected : candidates.slice(0, 3);
	}

	private buildClusterCandidate(config: IStrategyConfig, centerNode: IWorldResourceNode, requiredResources: string[], state: IAgentGameState): IResourceClusterCandidate
	{
		const selected: IWorldResourceNode[] = [];
		const selectedIds: {[key: string]: boolean} = {};
		const missingResources: string[] = [];
		const maxNodesPerResource = config.id === 'planB' ? 3 : 2;
		const tappedNodeIds = new Set(state.tappedNodes.map((node) => node.id));
		const worldNodes = state.worldResourceNodes.length ? state.worldResourceNodes : WORLD_RESOURCE_NODES;

		for (const resource of requiredResources) {
			let resourceNodes = worldNodes.filter((node) => {
				return node.item === resource && this.distance(centerNode.location, node.location) <= config.radius;
			});

			if (!resourceNodes.length) {
				missingResources.push(resource);
				resourceNodes = worldNodes.filter((node) => {
					return node.item === resource;
				});
			}

			resourceNodes.sort((nodeA, nodeB) => {
				const tappedDiff = (tappedNodeIds.has(nodeA.id) ? 1 : 0) - (tappedNodeIds.has(nodeB.id) ? 1 : 0);
				if (tappedDiff !== 0) {
					return tappedDiff;
				}
				const throughputDiff = this.getNodeRate(nodeB) - this.getNodeRate(nodeA);
				if (Math.abs(throughputDiff) > 0.001) {
					return throughputDiff;
				}
				return this.distance(centerNode.location, nodeA.location) - this.distance(centerNode.location, nodeB.location);
			});

			for (const node of resourceNodes.slice(0, maxNodesPerResource)) {
				if (!selectedIds[node.id]) {
					selectedIds[node.id] = true;
					selected.push(node);
				}
			}
		}

		if (!selected.length) {
			selected.push(centerNode);
		}

		const center = this.getCenter(selected);
		const coverageScore = requiredResources.length ? (requiredResources.length - missingResources.length) / requiredResources.length : 1;
		const throughputScore = Math.min(1, selected.reduce((sum, node) => {
			return sum + this.getNodeRate(node);
		}, 0) / Math.max(1, requiredResources.length * 600));
		const logisticsScore = 1 / (1 + this.averageDistance(center, selected) / 80000);
		const reusedTappedNodes = selected.filter((node) => tappedNodeIds.has(node.id)).length;
		const tappedPenalty = selected.length ? reusedTappedNodes / selected.length : 0;
		const factoryProximityScore = this.getFactoryProximityScore(center, state);
		const occupiedAreaScore = this.getOccupiedAreaScore(center, state);
		const routeScore = this.getRouteScore(center, state);
		const playerScore = this.getPlayerScore(center, state);
		let score = coverageScore * 100 + throughputScore * 25 + logisticsScore * 25 + occupiedAreaScore * 20 + routeScore * 15 + playerScore * 10 - tappedPenalty * 35;

		if (config.id === 'planA') {
			score += logisticsScore * 30 + factoryProximityScore * 25 + playerScore * 15;
		} else if (config.id === 'planB') {
			score += throughputScore * 45 + routeScore * 20;
		} else {
			score += occupiedAreaScore * 30 + routeScore * 15;
		}

		return {
			id: config.id + '-' + centerNode.id,
			name: centerNode.region + ' — ' + config.targetItems.map((item) => this.getItemName(item)).join(', '),
			center: center,
			nodes: selected,
			score: score,
			coverageScore: coverageScore,
			throughputScore: throughputScore,
			logisticsScore: logisticsScore,
			routeScore: routeScore,
			occupiedAreaScore: occupiedAreaScore,
			playerScore: playerScore,
			tappedPenalty: tappedPenalty,
			requiredResources: requiredResources,
			missingResources: missingResources,
		};
	}

	private createProductionRequest(config: IStrategyConfig, state: IAgentGameState, cluster: IResourceClusterCandidate, version: string): IProductionDataApiRequest
	{
		const resourceMax: {[key: string]: number} = {};
		for (const resource of Object.values(data.getRawData().resources)) {
			resourceMax[resource.item] = 0;
		}
		const defaultResourceAmounts = Data.resourceAmounts as {[key: string]: number};
		resourceMax[Constants.WATER_CLASSNAME] = defaultResourceAmounts[Constants.WATER_CLASSNAME] || Number.MAX_SAFE_INTEGER;

		for (const node of cluster.nodes) {
			resourceMax[node.item] = (resourceMax[node.item] || 0) + this.getNodeRate(node);
		}

		const allowedAlternates = state.availableRecipes.filter((className) => {
			const recipe = data.getRawData().recipes[className];
			return !!recipe && recipe.alternate && !isSamResourceConversion(recipe);
		});

		return {
			gameVersion: this.getApiVersion(version),
			resourceMax: resourceMax,
			resourceWeight: copyPlain(Data.resourceWeights),
			blockedResources: Object.keys(resourceMax).filter((item) => {
				return item !== Constants.WATER_CLASSNAME && resourceMax[item] <= 0;
			}),
			blockedRecipes: getDefaultBlockedRecipes(),
			blockedMachines: [],
			allowedAlternateRecipes: allowedAlternates,
			sinkableResources: [],
			resourceNodes: cluster.nodes.map((node) => {
				return {
					item: node.item,
					amount: 1,
					purity: node.purity,
					miner: this.getDefaultMinerClass(node.item),
					overclock: 250,
				};
			}),
			production: config.targetItems.map((item) => {
				return {
					item: item,
					type: config.type,
					amount: config.amount,
					ratio: config.ratio,
				};
			}),
			input: [],
		};
	}

	private createProductionData(config: IStrategyConfig, request: IProductionDataApiRequest, version: string): IProductionData
	{
		const copied = copyPlain(request) as IProductionDataApiRequest;
		delete (copied as any).gameVersion;

		return {
			metadata: {
				name: config.label + ': ' + config.targetItems.map((item) => this.getItemName(item)).join(', '),
				icon: config.targetItems[0],
				schemaVersion: 1,
				gameVersion: version,
			},
			request: copied as IProductionDataRequest,
		};
	}

	private createMapOverlay(
		worldNodes: IWorldResourceNode[],
		selectedNodes: IWorldResourceNode[],
		tappedNodes: IWorldResourceNode[],
		candidates: IResourceClusterCandidate[],
		selectedCluster: IResourceClusterCandidate,
		requiredResources: string[],
	): IMapOverlay
	{
		const bounds = this.mapBounds;
		const selectedIds = new Set(selectedNodes.map((node) => node.id));
		const tappedIds = new Set(tappedNodes.map((node) => node.id));
		const applicableItems = new Set(requiredResources);
		const nodes = worldNodes.map((node) => {
			return this.createMapNode(node, bounds, tappedIds.has(node.id), selectedIds.has(node.id), applicableItems.has(node.item));
		});
		const candidateOverlays = candidates.map((candidate, index) => {
			return {
				id: candidate.id,
				label: String.fromCharCode(65 + index),
				name: candidate.name,
				score: candidate.score,
				x: candidate.center.x,
				y: candidate.center.y,
				xPercent: this.percent(candidate.center.x, bounds.minX, bounds.maxX),
				yPercent: this.percent(candidate.center.y, bounds.minY, bounds.maxY),
				radius: Math.max(8000, this.averageDistance(candidate.center, candidate.nodes)),
				selected: candidate.id === selectedCluster.id,
			};
		});

		return {
			bounds: bounds,
			nodes: nodes,
			candidates: candidateOverlays,
			center: {
				x: selectedCluster.center.x,
				y: selectedCluster.center.y,
				xPercent: this.percent(selectedCluster.center.x, bounds.minX, bounds.maxX),
				yPercent: this.percent(selectedCluster.center.y, bounds.minY, bounds.maxY),
			},
		};
	}

	private createMapNode(
		node: IWorldResourceNode,
		bounds: {minX: number, maxX: number, minY: number, maxY: number},
		tapped: boolean,
		selected: boolean,
		applicable: boolean,
	): IMapOverlayNode
	{
		return {
			id: node.id,
			item: node.item,
			itemName: this.getItemName(node.item),
			purity: node.purity,
			rate: this.getNodeRate(node),
			x: node.location.x,
			y: node.location.y,
			xPercent: this.percent(node.location.x, bounds.minX, bounds.maxX),
			yPercent: this.percent(node.location.y, bounds.minY, bounds.maxY),
			tapped: tapped,
			selected: selected,
			applicable: applicable,
			source: node.source || 'catalog',
			note: node.note,
		};
	}

	private getRawResourceUse(resources: {[key: string]: {used: number}}): {[key: string]: number}
	{
		const result: {[key: string]: number} = {};
		for (const item of Object.keys(resources)) {
			if (resources[item].used > 0) {
				result[item] = resources[item].used;
			}
		}
		return result;
	}

	private getNodeRate(node: IWorldResourceNode): number
	{
		const minerClass = this.getDefaultMinerClass(node.item);
		if (!minerClass) {
			return 0;
		}
		const miner = data.getRawData().miners[minerClass];
		let rate = Formula.calculateExtractorExtractionValue(miner, node.purity as ResourcePurity) * 2.5;
		const item = data.getRawData().items[node.item];
		if (item && item.liquid) {
			rate /= 1000;
		}
		return rate;
	}

	private getDefaultMinerClass(item: string): string|null
	{
		const miners = Object.values(data.getRawData().miners).filter((miner) => {
			return this.isMinerCompatible(miner, item);
		}).sort((minerA, minerB) => {
			return Formula.calculateExtractorExtractionValue(minerB, 'pure') - Formula.calculateExtractorExtractionValue(minerA, 'pure');
		});

		return miners.length ? miners[0].className : null;
	}

	private isMinerCompatible(miner: IMinerSchema, item: string): boolean
	{
		if (miner.allowedResources.indexOf(item) !== -1) {
			return true;
		}
		const itemData = data.getRawData().items[item];
		return !miner.allowedResources.length && !!itemData && ((miner.allowLiquids && itemData.liquid) || (miner.allowSolids && !itemData.liquid));
	}

	private getCenter(nodes: IWorldResourceNode[]): IMapPoint
	{
		let x = 0;
		let y = 0;
		let z = 0;
		for (const node of nodes) {
			x += node.location.x;
			y += node.location.y;
			z += node.location.z || 0;
		}
		return {
			x: x / nodes.length,
			y: y / nodes.length,
			z: z / nodes.length,
		};
	}

	private averageDistance(center: IMapPoint, nodes: IWorldResourceNode[]): number
	{
		if (!nodes.length) {
			return 0;
		}
		return nodes.reduce((sum, node) => {
			return sum + this.distance(center, node.location);
		}, 0) / nodes.length;
	}

	private distance(a: IMapPoint, b: IMapPoint): number
	{
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		const dz = (a.z || 0) - (b.z || 0);
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	}

	private percent(value: number, min: number, max: number): number
	{
		if (Math.abs(max - min) < 0.00001) {
			return 50;
		}
		return Math.max(3, Math.min(97, ((value - min) / (max - min)) * 100));
	}

	private getItemName(item: string): string
	{
		return data.getRawData().items[item]?.name || item;
	}

	private formatPoint(point: IMapPoint): string
	{
		return Math.round(point.x) + ', ' + Math.round(point.y) + (typeof point.z === 'number' ? ', ' + Math.round(point.z) : '');
	}

	private getApiVersion(version: string): string
	{
		switch (version) {
			case '0.8':
				return '0.8.0';
			case '1.0-ficsmas':
				return '1.0.0-ficsmas';
			case '1.2':
				return '1.2.0';
			default:
				return '1.0.0';
		}
	}

	private getStock(item: string, state: IAgentGameState): number
	{
		return state.inventoryTotals && state.inventoryTotals[item] || 0;
	}

	private getInfrastructureCoverage(item: string, desiredStock: number, state: IAgentGameState): number
	{
		return this.getStock(item, state) / Math.max(1, desiredStock);
	}

	private getFactoryProximityScore(center: IMapPoint, state: IAgentGameState): number
	{
		if (!state.factoryClusters.length) {
			return 0;
		}

		let nearestDistance = Number.MAX_SAFE_INTEGER;
		for (const cluster of state.factoryClusters) {
			nearestDistance = Math.min(nearestDistance, this.distance(center, cluster.center));
		}

		return 1 / (1 + nearestDistance / 120000);
	}

	private getOccupiedAreaScore(center: IMapPoint, state: IAgentGameState): number
	{
		if (!state.occupiedFactoryAreas.length) {
			return 1;
		}

		let nearestDistance = Number.MAX_SAFE_INTEGER;
		for (const area of state.occupiedFactoryAreas) {
			nearestDistance = Math.min(nearestDistance, this.distance(center, area.center) - (area.radius || 0));
		}

		if (nearestDistance <= 0) {
			return 0;
		}
		return Math.min(1, nearestDistance / 90000);
	}

	private getRouteScore(center: IMapPoint, state: IAgentGameState): number
	{
		if (!state.transportRoutes.length) {
			return 0;
		}

		let nearestDistance = Number.MAX_SAFE_INTEGER;
		for (const route of state.transportRoutes) {
			nearestDistance = Math.min(nearestDistance, this.distance(center, route.location));
		}

		return 1 / (1 + nearestDistance / 90000);
	}

	private getPlayerScore(center: IMapPoint, state: IAgentGameState): number
	{
		if (!state.playerLocation) {
			return 0;
		}
		return 1 / (1 + this.distance(center, state.playerLocation) / 140000);
	}

	private createUniqueId(prefix: string): string
	{
		return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
	}

	private normalizeState(state: IAgentGameState): IAgentGameState
	{
		const normalizedProductionRates: IAgentGameState['productionRates'] = {};
		for (const item of Object.keys(state.productionRates || {})) {
			const summary = state.productionRates[item] as any;
			normalizedProductionRates[item] = {
				item: summary.item || item,
				potentialRate: Number(summary.potentialRate ?? summary.rate) || 0,
				machineCount: Number(summary.machineCount) || 0,
				confidence: summary.confidence || 'inferred',
				recipes: summary.recipes || [],
				warnings: summary.warnings || [],
			};
		}
		return {
			...state,
			worldResourceNodes: state.worldResourceNodes && state.worldResourceNodes.length ? state.worldResourceNodes : WORLD_RESOURCE_NODES,
			resourceWells: state.resourceWells || [],
			tappedNodes: state.tappedNodes || [],
			factoryClusters: state.factoryClusters || [],
			occupiedFactoryAreas: state.occupiedFactoryAreas || [],
			resourceStatus: state.resourceStatus || {},
			productionRates: normalizedProductionRates,
			playerLocation: state.playerLocation || null,
			transportRoutes: state.transportRoutes || [],
			projectAssembly: state.projectAssembly ? {
				...state.projectAssembly,
				completedPhase: typeof state.projectAssembly.completedPhase === 'number'
					? state.projectAssembly.completedPhase
					: Math.max(0, (state.projectAssembly.currentPhase || 1) - 1),
				targetPhase: state.projectAssembly.targetPhase || null,
				phaseSource: state.projectAssembly.phaseSource || 'inferred',
			} : null,
			availableRecipes: state.availableRecipes || [],
			unlockedSchematics: state.unlockedSchematics || [],
			activeSchematic: state.activeSchematic || null,
			inventoryTotals: state.inventoryTotals || {},
			buildingCounts: state.buildingCounts || {},
			notes: state.notes || [],
		};
	}

}
