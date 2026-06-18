import {Parser, SaveComponent, SaveEntity, SatisfactorySave} from '@etothepii/satisfactory-file-parser';
import data from '@src/Data/Data';
import {
	IAgentGameState,
	IFactoryCluster,
	IMapPoint,
	IOccupiedFactoryArea,
	IProductionRateSummary,
	IResourceStatus,
	ITappedResourceNode,
	ITransportRoutePoint,
	IWorldResourceNode,
	IWorldResourceWell,
} from '@src/AgentPlanner/Types';
import {WORLD_RESOURCE_NODES} from '@src/AgentPlanner/ResourceNodeCatalog';
import {IProjectAssemblyPartProgress, IProjectAssemblyProgress, PROJECT_ASSEMBLY_REQUIREMENTS, PROJECT_ASSEMBLY_TOTAL_QUOTA} from '@src/AgentPlanner/ProjectAssembly';

type SaveObject = SaveEntity|SaveComponent;

export class SaveGameStateExtractor
{

	public async extractFromFile(file: File, gameVersion: string): Promise<IAgentGameState>
	{
		const buffer = await file.arrayBuffer();
		const parsed = Parser.ParseSave(file.name.replace(/\.sav$/i, ''), buffer, {
			throwErrors: false,
		});

		return this.extract(parsed, file.name, gameVersion);
	}

	public createEmptyState(gameVersion: string): IAgentGameState
	{
		return {
			saveName: 'No save loaded',
			gameVersion: gameVersion,
			parsedAt: new Date().toISOString(),
			objectCount: 0,
			buildingCount: 0,
			worldResourceNodes: WORLD_RESOURCE_NODES.map((node) => ({...node, source: 'catalog'})),
			resourceWells: [],
			tappedNodes: [],
			factoryClusters: [],
			occupiedFactoryAreas: [],
			resourceStatus: this.createResourceStatus([]),
			productionRates: {},
			playerLocation: null,
			transportRoutes: [],
			projectAssembly: this.createProjectAssemblyProgress({}, {}, null),
			availableRecipes: [],
			unlockedSchematics: [],
			inventoryTotals: {},
			buildingCounts: {},
			notes: [
				'Upload a .sav file to replace this starter state. Current options use the global resource catalog and base recipes.',
			],
		};
	}

	private extract(save: SatisfactorySave, saveName: string, gameVersion: string): IAgentGameState
	{
		const objects = this.getObjects(save);
		const buildingObjects = objects.filter((object) => {
			return this.getBuildingClassName(object) !== null;
		});
		const worldResourceNodes = this.collectWorldResourceNodes(objects);
		const resourceWells = this.collectResourceWells(objects);
		const tappedNodes = this.findTappedNodes(objects, worldResourceNodes);
		const classNameIndex = this.collectClassNameReferences(objects);
		const rawData = data.getRawData();
		const availableRecipes = Object.keys(classNameIndex).filter((className) => {
			return className in rawData.recipes;
		}).sort();
		const unlockedSchematics = Object.keys(classNameIndex).filter((className) => {
			return className in rawData.schematics;
		}).sort();
		const factoryClusters = this.buildFactoryClusters(buildingObjects);
		const occupiedFactoryAreas = this.buildOccupiedFactoryAreas(buildingObjects);
		const inventoryTotals = this.collectInventoryTotals(objects);
		const productionRates = this.collectProductionRates(objects);
		const buildingCounts = this.collectBuildingCounts(buildingObjects);
		const playerLocation = this.findPlayerLocation(objects);
		const transportRoutes = this.collectTransportRoutes(buildingObjects);
		const resourceStatus = this.createResourceStatus(tappedNodes, worldResourceNodes);
		const projectAssembly = this.createProjectAssemblyProgress(inventoryTotals, productionRates, this.findGamePhase(objects));
		const notes: string[] = [];

		if (!availableRecipes.length) {
			notes.push('No explicit unlocked recipe list was found in the parsed save; base recipes are used for planning.');
		}
		if (!tappedNodes.length) {
			notes.push('No existing miners were matched to the starter node catalog; options treat selected nodes as new outposts.');
		}
		if (!factoryClusters.length) {
			notes.push('No factory cluster center could be inferred from placed buildings.');
		}
		if (!playerLocation) {
			notes.push('No player location could be inferred from this parsed save.');
		}
		if (!transportRoutes.length) {
			notes.push('No train or truck route landmarks were found; route scoring uses resource and factory proximity only.');
		}
		notes.push('Space Elevator delivery totals are inferred from inventory and production state unless explicit delivery fields are exposed by the save parser.');

		return {
			saveName: saveName,
			gameVersion: gameVersion,
			parsedAt: new Date().toISOString(),
			objectCount: objects.length,
			buildingCount: buildingObjects.length,
			worldResourceNodes: worldResourceNodes,
			resourceWells: resourceWells,
			tappedNodes: tappedNodes,
			factoryClusters: factoryClusters,
			occupiedFactoryAreas: occupiedFactoryAreas,
			resourceStatus: resourceStatus,
			productionRates: productionRates,
			playerLocation: playerLocation,
			transportRoutes: transportRoutes,
			projectAssembly: projectAssembly,
			availableRecipes: availableRecipes,
			unlockedSchematics: unlockedSchematics,
			inventoryTotals: inventoryTotals,
			buildingCounts: buildingCounts,
			notes: notes,
		};
	}

	private collectInventoryTotals(objects: SaveObject[]): {[item: string]: number}
	{
		const result: {[item: string]: number} = {};
		for (const object of objects) {
			const stacks = object.properties?.mInventoryStacks?.values || [];
			for (const stack of stacks) {
				const itemPath = stack.properties?.Item?.value?.itemReference?.pathName || '';
				const amount = stack.properties?.NumItems?.value || 0;
				const item = this.getClassNameFromTypePath(itemPath);
				if (!item || amount <= 0) {
					continue;
				}
				result[item] = (result[item] || 0) + amount;
			}
		}
		return result;
	}

	private collectProductionRates(objects: SaveObject[]): {[item: string]: IProductionRateSummary}
	{
		const result: {[item: string]: IProductionRateSummary} = {};
		const rawData = data.getRawData();
		for (const object of objects) {
			const recipeClassName = this.getClassNameFromTypePath(object.properties?.mCurrentRecipe?.value?.pathName || '');
			const recipe = recipeClassName ? rawData.recipes[recipeClassName] : null;
			const machineClassName = this.getBuildingClassName(object);
			if (!recipe || !machineClassName || !recipe.products || !recipe.products.length || !recipe.time) {
				continue;
			}
			const clockMultiplier = this.findClockMultiplier(object);
			const productionBoost = this.findProductionBoost(object);
			for (const product of recipe.products) {
				const rate = product.amount * 60 / recipe.time * clockMultiplier * productionBoost;
				if (!result[product.item]) {
					result[product.item] = {
						item: product.item,
						potentialRate: 0,
						machineCount: 0,
						confidence: 'high',
						recipes: [],
						warnings: [],
					};
				}
				result[product.item].potentialRate += rate;
				result[product.item].machineCount++;
				let recipeCapacity = result[product.item].recipes.find((candidate) => {
					return candidate.recipe === recipeClassName && candidate.machine === machineClassName;
				});
				if (!recipeCapacity) {
					recipeCapacity = {
						recipe: recipeClassName as string,
						machine: machineClassName,
						machineCount: 0,
						potentialRate: 0,
					};
					result[product.item].recipes.push(recipeCapacity);
				}
				recipeCapacity.machineCount++;
				recipeCapacity.potentialRate += rate;
			}
		}
		return result;
	}

	private findClockMultiplier(object: SaveObject): number
	{
		const clockValues = [
			object.properties?.mCurrentPotential?.value,
			object.properties?.mPendingPotential?.value,
		];
		for (const value of clockValues) {
			if (typeof value === 'number' && value > 0) {
				return value > 10 ? value / 100 : value;
			}
		}
		return 1;
	}

	private findProductionBoost(object: SaveObject): number
	{
		const value = object.properties?.mCurrentProductionBoost?.value;
		if (typeof value !== 'number' || value <= 0) {
			return 1;
		}
		return value > 10 ? value / 100 : value;
	}

	private collectBuildingCounts(objects: SaveObject[]): {[buildingClassName: string]: number}
	{
		const result: {[buildingClassName: string]: number} = {};
		for (const object of objects) {
			const buildingClassName = this.getBuildingClassName(object);
			if (!buildingClassName) {
				continue;
			}
			result[buildingClassName] = (result[buildingClassName] || 0) + 1;
		}
		return result;
	}

	private getObjects(save: SatisfactorySave): SaveObject[]
	{
		const result: SaveObject[] = [];
		for (const level of Object.values(save.levels)) {
			for (const object of level.objects) {
				result.push(object);
			}
		}
		return result;
	}

	private collectWorldResourceNodes(objects: SaveObject[]): IWorldResourceNode[]
	{
		const nodes: IWorldResourceNode[] = [];
		for (const object of objects) {
			if (!this.hasPoint(object) || !/BP_ResourceNode\.BP_ResourceNode_C$/.test(object.typePath || '')) {
				continue;
			}
			const item = this.getClassNameFromTypePath(object.properties?.mResourceClassOverride?.value?.pathName || '');
			if (!item || !this.isRawResourceItem(item)) {
				continue;
			}
			const location = object.transform.translation;
			nodes.push({
				id: this.sanitizeId(object.instanceName || 'save-resource-node'),
				item: item,
				purity: this.getResourcePurity(object.properties?.mPurityOverride?.value?.value),
				location: location,
				region: this.inferRegion(location),
				source: 'save',
			});
		}

		return nodes.length ? nodes : WORLD_RESOURCE_NODES.map((node) => ({...node, source: 'catalog'}));
	}

	private collectResourceWells(objects: SaveObject[]): IWorldResourceWell[]
	{
		const satellites = objects.filter((object): object is SaveEntity => {
			return this.hasPoint(object) && /BP_FrackingSatellite\.BP_FrackingSatellite_C$/.test(object.typePath || '');
		});
		const wells: IWorldResourceWell[] = [];
		for (const object of objects) {
			if (!this.hasPoint(object) || !/BP_FrackingCore\.BP_FrackingCore_C$/.test(object.typePath || '')) {
				continue;
			}
			const item = this.getClassNameFromTypePath(object.properties?.mResourceClassOverride?.value?.pathName || '');
			if (!item || !this.isRawResourceItem(item)) {
				continue;
			}
			const matchingSatellites = satellites.filter((satellite) => {
				const satelliteItem = this.getClassNameFromTypePath(satellite.properties?.mResourceClassOverride?.value?.pathName || '');
				return satelliteItem === item && this.distance(object.transform.translation, satellite.transform.translation) <= 30000;
			}).map((satellite) => {
				return {
					id: this.sanitizeId(satellite.instanceName || 'save-fracking-satellite'),
					location: satellite.transform.translation,
					purity: this.getResourcePurity(satellite.properties?.mPurityOverride?.value?.value),
				};
			});
			wells.push({
				id: this.sanitizeId(object.instanceName || 'save-fracking-core'),
				item: item,
				location: object.transform.translation,
				satellites: matchingSatellites,
			});
		}
		return wells;
	}

	private findTappedNodes(objects: SaveObject[], worldResourceNodes: IWorldResourceNode[]): ITappedResourceNode[]
	{
		const result: ITappedResourceNode[] = [];
		const usedNodeIds: {[key: string]: boolean} = {};
		const objectIndex = this.buildObjectIndex(objects);
		for (const object of objects) {
			const className = this.getClassNameFromTypePath(object.typePath);
			const minerClass = this.normalizeMinerClassName(className);
			if (!minerClass || !this.hasPoint(object)) {
				continue;
			}

			const item = this.inferExtractorResourceItem(object, objectIndex);
			const nearest = this.findNearestResourceNode(object.transform.translation, item, worldResourceNodes);
			if (nearest && nearest.distance <= 8000 && !usedNodeIds[nearest.node.id]) {
				usedNodeIds[nearest.node.id] = true;
				result.push({
					...nearest.node,
					existingMinerClass: minerClass,
					distanceToSaveObject: nearest.distance,
				});
				continue;
			}

			if (!item) {
				continue;
			}

			const resourceRef = this.getObjectReferencePath(object.properties?.mExtractableResource?.value);
			const resourceObject = resourceRef ? objectIndex[resourceRef] : null;
			const syntheticId = 'save-' + (resourceRef || object.instanceName || '').replace(/[^A-Za-z0-9_-]+/g, '-');
			if (usedNodeIds[syntheticId]) {
				continue;
			}

			const location = resourceObject && this.hasPoint(resourceObject) ? resourceObject.transform.translation : object.transform.translation;
			usedNodeIds[syntheticId] = true;
			result.push({
				id: syntheticId,
				item: item,
				purity: 'normal',
				location: location,
				region: 'Existing save extractor',
				note: 'Resource type was inferred from the placed extractor output inventory; node purity is not exposed in this save snapshot.',
				existingMinerClass: minerClass,
				distanceToSaveObject: this.distance(location, object.transform.translation),
			});
		}

		return result;
	}

	private buildObjectIndex(objects: SaveObject[]): {[key: string]: SaveObject}
	{
		const result: {[key: string]: SaveObject} = {};
		for (const object of objects) {
			if (object.instanceName) {
				result[object.instanceName] = object;
			}
		}
		return result;
	}

	private inferExtractorResourceItem(object: SaveObject, objectIndex: {[key: string]: SaveObject}): string|null
	{
		const outputInventoryRef = this.getObjectReferencePath(object.properties?.mOutputInventory?.value);
		const outputInventory = outputInventoryRef ? objectIndex[outputInventoryRef] : null;
		if (outputInventory) {
			const item = this.getResourceItemFromInventory(outputInventory);
			if (item) {
				return item;
			}
		}

		const className = this.getClassNameFromTypePath(object.typePath);
		if (className === 'Build_WaterPump_C' || className === 'Desc_WaterPump_C') {
			return 'Desc_Water_C';
		}

		return null;
	}

	private getResourceItemFromInventory(inventory: SaveObject): string|null
	{
		const stacks = inventory.properties?.mInventoryStacks?.values || [];
		for (const stack of stacks) {
			const item = this.getClassNameFromTypePath(stack.properties?.Item?.value?.itemReference?.pathName || '');
			if (this.isRawResourceItem(item)) {
				return item;
			}
		}

		const allowedDescriptors = inventory.properties?.mAllowedItemDescriptors?.values || [];
		for (const descriptor of allowedDescriptors) {
			const item = this.getClassNameFromTypePath(descriptor.pathName || '');
			if (this.isRawResourceItem(item)) {
				return item;
			}
		}

		return null;
	}

	private isRawResourceItem(item: string|null): item is string
	{
		return !!item && item in data.getRawData().resources;
	}

	private getObjectReferencePath(value: any): string|null
	{
		if (!value || typeof value.pathName !== 'string' || value.pathName === '') {
			return null;
		}
		return value.pathName;
	}

	private buildFactoryClusters(objects: SaveObject[]): IFactoryCluster[]
	{
		const points: IMapPoint[] = [];
		for (const object of objects) {
			if (this.hasPoint(object)) {
				points.push(object.transform.translation);
			}
		}

		if (!points.length) {
			return [];
		}

		let x = 0;
		let y = 0;
		let z = 0;
		for (const point of points) {
			x += point.x;
			y += point.y;
			z += point.z || 0;
		}

		return [{
			id: 'main-factory',
			name: 'Inferred factory center',
			center: {
				x: x / points.length,
				y: y / points.length,
				z: z / points.length,
			},
			buildingCount: points.length,
		}];
	}

	private buildOccupiedFactoryAreas(objects: SaveObject[]): IOccupiedFactoryArea[]
	{
		const points = objects.filter((object) => {
			return this.hasPoint(object);
		}).map((object) => {
			return object.transform.translation;
		});
		const clusters: IMapPoint[][] = [];
		const clusterRadius = 45000;
		for (const point of points) {
			let bestCluster: IMapPoint[]|null = null;
			let bestDistance = Number.MAX_SAFE_INTEGER;
			for (const cluster of clusters) {
				const center = this.getCenter(cluster);
				const distance = this.distance(point, center);
				if (distance < clusterRadius && distance < bestDistance) {
					bestDistance = distance;
					bestCluster = cluster;
				}
			}
			if (bestCluster) {
				bestCluster.push(point);
			} else {
				clusters.push([point]);
			}
		}

		return clusters.filter((cluster) => {
			return cluster.length >= 3;
		}).sort((a, b) => {
			return b.length - a.length;
		}).slice(0, 12).map((cluster, index) => {
			const center = this.getCenter(cluster);
			const min = this.getMinPoint(cluster);
			const max = this.getMaxPoint(cluster);
			return {
				id: 'occupied-area-' + (index + 1),
				name: 'Occupied factory area ' + (index + 1),
				center: center,
				min: min,
				max: max,
				radius: Math.max(5000, this.averagePointDistance(center, cluster)),
				buildingCount: cluster.length,
			};
		});
	}

	private createResourceStatus(tappedNodes: ITappedResourceNode[], worldResourceNodes: IWorldResourceNode[] = WORLD_RESOURCE_NODES): {[item: string]: IResourceStatus}
	{
		const tappedIds = new Set(tappedNodes.map((node) => {
			return node.id;
		}));
		const result: {[item: string]: IResourceStatus} = {};
		for (const node of worldResourceNodes) {
			if (!result[node.item]) {
				result[node.item] = {
					total: 0,
					tapped: 0,
					untapped: 0,
					unknown: 0,
				};
			}
			result[node.item].total++;
			if (tappedIds.has(node.id)) {
				result[node.item].tapped++;
			} else {
				result[node.item].untapped++;
			}
		}
		return result;
	}

	private findPlayerLocation(objects: SaveObject[]): IMapPoint|null
	{
		for (const object of objects) {
			if (!this.hasPoint(object)) {
				continue;
			}
			const className = this.getClassNameFromTypePath(object.typePath) || '';
			if (/Char_Player|PlayerState|Pawn|Character/i.test(className) || /Persistent_Level:PersistentLevel\.Char_Player/i.test(object.instanceName || '')) {
				return object.transform.translation;
			}
		}
		return null;
	}

	private collectTransportRoutes(objects: SaveObject[]): ITransportRoutePoint[]
	{
		const result: ITransportRoutePoint[] = [];
		for (const object of objects) {
			if (!this.hasPoint(object)) {
				continue;
			}
			const buildingClassName = this.getBuildingClassName(object) || this.getClassNameFromTypePath(object.typePath) || '';
			const routeType = this.getTransportRouteType(buildingClassName);
			if (!routeType) {
				continue;
			}
			result.push({
				id: (object.instanceName || buildingClassName + '-' + result.length).replace(/[^A-Za-z0-9_-]+/g, '-'),
				type: routeType,
				name: buildingClassName,
				location: object.transform.translation,
			});
		}
		return result.slice(0, 500);
	}

	private getTransportRouteType(className: string): ITransportRoutePoint['type']|null
	{
		if (/TrainStation|TrainDockingStation/i.test(className)) {
			return 'trainStation';
		}
		if (/RailroadTrack|RailroadBlockSignal|RailroadPathSignal/i.test(className)) {
			return 'trainTrack';
		}
		if (/TruckStation|FluidTruckStation/i.test(className)) {
			return 'truckStop';
		}
		if (/VehiclePath/i.test(className)) {
			return 'truckPath';
		}
		return null;
	}

	private findGamePhase(objects: SaveObject[]): {currentPhase: number, targetPhase: number|null}|null
	{
		const manager = objects.find((object) => {
			return /BP_GamePhaseManager\.BP_GamePhaseManager_C$/.test(object.typePath || '');
		});
		if (!manager) {
			return null;
		}
		const currentPath = manager.properties?.mCurrentGamePhase?.value?.pathName || '';
		const targetPath = manager.properties?.mTargetGamePhase?.value?.pathName || '';
		const currentMatch = currentPath.match(/Phase_(\d+)/i);
		const targetMatch = targetPath.match(/Phase_(\d+)/i);
		if (!currentMatch) {
			return null;
		}
		return {
			currentPhase: Math.max(1, Math.min(5, parseInt(currentMatch[1], 10))),
			targetPhase: targetMatch ? Math.max(1, Math.min(5, parseInt(targetMatch[1], 10))) : null,
		};
	}

	private createProjectAssemblyProgress(
		inventoryTotals: {[item: string]: number},
		productionRates: {[item: string]: IProductionRateSummary},
		phaseInfo: {currentPhase: number, targetPhase: number|null}|null,
	): IProjectAssemblyProgress
	{
		let currentPhase = phaseInfo ? phaseInfo.currentPhase : 5;
		if (!phaseInfo) {
			for (let phaseIndex = 0; phaseIndex < 5; phaseIndex++) {
				const phaseIsComplete = PROJECT_ASSEMBLY_REQUIREMENTS.every((requirement) => {
					const requiredThroughPhase = this.sumPhaseDeliveries(requirement.phaseDeliveries, phaseIndex + 1);
					return (inventoryTotals[requirement.item] || 0) >= requiredThroughPhase;
				});
				if (!phaseIsComplete) {
					currentPhase = phaseIndex + 1;
					break;
				}
			}
		}

		const parts: IProjectAssemblyPartProgress[] = PROJECT_ASSEMBLY_REQUIREMENTS.map((requirement) => {
			const currentStock = inventoryTotals[requirement.item] || 0;
			const directRequiredThroughPhase = phaseInfo
				? requirement.phaseDeliveries[currentPhase - 1] || 0
				: this.sumPhaseDeliveries(requirement.phaseDeliveries, currentPhase);
			const directRemaining = Math.max(0, directRequiredThroughPhase - currentStock);
			const absoluteRemaining = Math.max(0, requirement.absoluteTotal - currentStock);
			const nextPhaseIndex = requirement.phaseDeliveries.findIndex((amount, index) => {
				return index + 1 >= currentPhase && amount > 0 && currentStock < this.sumPhaseDeliveries(requirement.phaseDeliveries, index + 1);
			});
			return {
				item: requirement.item,
				name: requirement.name,
				currentStock: currentStock,
				currentRate: productionRates[requirement.item]?.potentialRate || 0,
				directRequiredThroughPhase: directRequiredThroughPhase,
				directRemaining: directRemaining,
				absoluteTotal: requirement.absoluteTotal,
				absoluteRemaining: absoluteRemaining,
				nextPhase: nextPhaseIndex === -1 ? null : nextPhaseIndex + 1,
				confidence: 'inferred',
			};
		});

		return {
			currentPhase: currentPhase,
			targetPhase: phaseInfo ? phaseInfo.targetPhase : null,
			totalAbsoluteQuota: PROJECT_ASSEMBLY_TOTAL_QUOTA,
			totalAbsoluteRemaining: parts.reduce((sum, part) => {
				return sum + part.absoluteRemaining;
			}, 0),
			parts: parts,
			confidence: 'inferred',
			phaseSource: phaseInfo ? 'save' : 'inferred',
			notes: [
				phaseInfo
					? 'The current Project Assembly phase is read from the save. Part progress shows available inventory because exact delivered totals are not exposed.'
					: 'Project Assembly phase and progress are inferred from inventory because exact delivery fields were not exposed.',
			],
		};
	}

	private collectClassNameReferences(objects: SaveObject[]): {[key: string]: boolean}
	{
		const result: {[key: string]: boolean} = {};
		const maxObjects = Math.min(objects.length, 3500);
		for (let i = 0; i < maxObjects; i++) {
			this.scanValue(objects[i].typePath, result, 0);
			this.scanValue(objects[i].properties, result, 0);
		}
		return result;
	}

	private scanValue(value: any, result: {[key: string]: boolean}, depth: number): void
	{
		if (depth > 6 || value === null || typeof value === 'undefined') {
			return;
		}

		if (typeof value === 'string') {
			const matches = value.match(/[A-Za-z0-9_]+_C/g);
			if (matches) {
				for (const match of matches) {
					result[match] = true;
				}
			}
			return;
		}

		if (typeof value !== 'object') {
			return;
		}

		if (Array.isArray(value)) {
			for (let i = 0; i < Math.min(value.length, 80); i++) {
				this.scanValue(value[i], result, depth + 1);
			}
			return;
		}

		for (const key of Object.keys(value).slice(0, 80)) {
			this.scanValue(key, result, depth + 1);
			this.scanValue(value[key], result, depth + 1);
		}
	}

	private getBuildingClassName(object: SaveObject): string|null
	{
		const className = this.getClassNameFromTypePath(object.typePath);
		if (!className) {
			return null;
		}

		const rawData = data.getRawData();
		if (className in rawData.buildings) {
			return className;
		}

		if (className.indexOf('Build_') === 0) {
			const descriptorClassName = 'Desc_' + className.substring('Build_'.length);
			if (descriptorClassName in rawData.buildings) {
				return descriptorClassName;
			}
		}

		return null;
	}

	private normalizeMinerClassName(className: string|null): string|null
	{
		if (!className) {
			return null;
		}
		const rawData = data.getRawData();
		if (className in rawData.miners) {
			return className;
		}
		if (className.indexOf('Desc_') === 0) {
			const buildClassName = 'Build_' + className.substring('Desc_'.length);
			if (buildClassName in rawData.miners) {
				return buildClassName;
			}
		}
		if (/Miner|OilPump/.test(className)) {
			for (const minerClass of Object.keys(rawData.miners)) {
				if (className.indexOf(minerClass.replace('Build_', '').replace('_C', '')) !== -1) {
					return minerClass;
				}
			}
		}
		return null;
	}

	private getClassNameFromTypePath(typePath: string): string|null
	{
		if (!typePath) {
			return null;
		}
		const match = typePath.match(/\.([A-Za-z0-9_]+)$/);
		if (match) {
			return match[1];
		}
		const parts = typePath.split('/');
		return parts.length ? parts[parts.length - 1] : null;
	}

	private sanitizeId(value: string): string
	{
		return value.replace(/[^A-Za-z0-9_-]+/g, '-');
	}

	private getResourcePurity(value: string): IWorldResourceNode['purity']
	{
		if (value === 'RP_Inpure') {
			return 'impure';
		}
		if (value === 'RP_Pure') {
			return 'pure';
		}
		return 'normal';
	}

	private inferRegion(point: IMapPoint): string
	{
		let nearest: IWorldResourceNode|null = null;
		let nearestDistance = Number.MAX_SAFE_INTEGER;
		for (const node of WORLD_RESOURCE_NODES) {
			const distance = this.distance(point, node.location);
			if (distance < nearestDistance) {
				nearest = node;
				nearestDistance = distance;
			}
		}
		return nearest ? nearest.region : 'Save-derived node';
	}

	private findNearestResourceNode(point: IMapPoint, item: string|null|undefined, worldResourceNodes: IWorldResourceNode[]): {node: IWorldResourceNode, distance: number}|null
	{
		let nearest: {node: IWorldResourceNode, distance: number}|null = null;
		for (const node of worldResourceNodes) {
			if (item && node.item !== item) {
				continue;
			}
			const distance = this.distance(point, node.location);
			if (nearest === null || distance < nearest.distance) {
				nearest = {
					node: node,
					distance: distance,
				};
			}
		}
		return nearest;
	}

	private hasPoint(object: SaveObject): object is SaveEntity
	{
		return (object as SaveEntity).transform && (object as SaveEntity).transform.translation !== undefined;
	}

	private getCenter(points: IMapPoint[]): IMapPoint
	{
		let x = 0;
		let y = 0;
		let z = 0;
		for (const point of points) {
			x += point.x;
			y += point.y;
			z += point.z || 0;
		}
		return {
			x: x / points.length,
			y: y / points.length,
			z: z / points.length,
		};
	}

	private getMinPoint(points: IMapPoint[]): IMapPoint
	{
		return {
			x: Math.min(...points.map((point) => point.x)),
			y: Math.min(...points.map((point) => point.y)),
			z: Math.min(...points.map((point) => point.z || 0)),
		};
	}

	private getMaxPoint(points: IMapPoint[]): IMapPoint
	{
		return {
			x: Math.max(...points.map((point) => point.x)),
			y: Math.max(...points.map((point) => point.y)),
			z: Math.max(...points.map((point) => point.z || 0)),
		};
	}

	private averagePointDistance(center: IMapPoint, points: IMapPoint[]): number
	{
		if (!points.length) {
			return 0;
		}
		return points.reduce((sum, point) => {
			return sum + this.distance(center, point);
		}, 0) / points.length;
	}

	private sumPhaseDeliveries(phaseDeliveries: number[], phase: number): number
	{
		return phaseDeliveries.slice(0, phase).reduce((sum, amount) => {
			return sum + amount;
		}, 0);
	}

	private distance(a: IMapPoint, b: IMapPoint): number
	{
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		const dz = (a.z || 0) - (b.z || 0);
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	}

}
