import angular, {ITimeoutService} from 'angular';
import {Constants, RESOURCE_PURITY} from '@src/Constants';
import data, {Data} from '@src/Data/Data';
import {IProductionControllerScope} from '@src/Module/Controllers/ProductionController';
import axios from 'axios';
import {Strings} from '@src/Utils/Strings';
import {IItemSchema} from '@src/Schema/IItemSchema';
import {Callbacks} from '@src/Utils/Callbacks';
import {IProductionData, IProductionDataApiRequest, IProductionDataRequestInput, IProductionDataRequestItem, IProductionDataResourceNode} from '@src/Tools/Production/IProductionData';
import {ResultStatus} from '@src/Tools/Production/ResultStatus';
import {Solver} from '@src/Solver/Solver';
import {ProductionResult} from '@src/Tools/Production/Result/ProductionResult';
import {ProductionResultFactory} from '@src/Tools/Production/Result/ProductionResultFactory';
import {DataProvider} from '@src/Data/DataProvider';
import {IRecipeSchema} from '@src/Schema/IRecipeSchema';
import {Formula} from '@src/Formula';
import {IMinerSchema} from '@src/Schema/IMinerSchema';

export class ProductionTab
{

	public state = {
		expanded: true,
		renaming: false,
		sinkableResourcesExpanded: true,
		alternateRecipesExpanded: true,
		basicRecipesExpanded: true,
		sinkableResourcesSortBy: 'name',
		sinkableResourcesSortReverse: false,
		sinkableResourcesQuery: '',
		alternateRecipesQuery: '',
		basicRecipesQuery: '',
		resultLoading: false,
		buildingsExpanded: {},
		powerExpanded: {},
		itemsExpanded: {},
		overviewCollapsed: {},
		visualizationMode: 'diagram',
	};

	public tab: string = 'production';
	public resultTab: string = 'visualization';
	public shareLink: string = '';
	public resultStatus: ResultStatus = ResultStatus.NO_INPUT;
	public resultNew: ProductionResult|undefined;
	public easter: boolean = false;
	public readonly resourcePurities: RESOURCE_PURITY[] = ['impure', 'normal', 'pure'];
	public readonly resourceNodeOverclockOptions: number[] = [100, 250];
	public data: IProductionData;

	private readonly unregisterCallback: () => void;
	private firstRun: boolean = true;

	public constructor(private readonly scope: IProductionControllerScope, private readonly version: string, productionData?: IProductionData)
	{
		if (productionData) {
			this.data = productionData;
		} else {
			this.resetData();
			this.addEmptyProduct();
		}

		if (typeof this.data.request.blockedMachines === 'undefined') {
			this.data.request.blockedMachines = [];
		}
		this.normalizeResourceNodes();

		this.unregisterCallback = scope.$watch(() => {
			return this.data.request;
		}, Callbacks.debounce((newValue, oldValue) => {
			this.firstRun = false;
			this.scope.saveState();
			this.shareLink = '';
			this.calculate(this.scope.$timeout);
		}, 400), true);
	}

	public get gameVersion(): string
	{
		return this.version;
	}

	public calculate($timeout?: ITimeoutService): void
	{
		let request = false;
		this.easter = false;
		for (const item of this.data.request.production) {
			if (item.item === 'Desc_ColorCartridge_C' && item.amount === 69420) {
				this.easter = true;
			}
		}

		for (const product of this.data.request.production) {
			if (product.item && product.amount > 0) {
				request = true;
				break;
			}
		}

		if (!request) {
			this.resultStatus = ResultStatus.NO_INPUT;
			return;
		}

		this.resultStatus = ResultStatus.CALCULATING;

		const calc = () => {
			const apiRequest: IProductionDataApiRequest = angular.copy(this.data.request) as IProductionDataApiRequest;
			switch (this.version) {
				case '0.8':
					apiRequest.gameVersion = '0.8.0';
					break;
				case '1.0-ficsmas':
					apiRequest.gameVersion = '1.0.0-ficsmas';
					break;
				case '1.2':
					apiRequest.gameVersion = '1.2.0';
					break;
				default:
					apiRequest.gameVersion = '1.0.0';
			}

			const blockedMachines = apiRequest.blockedMachines || [];
			const allowedAlts: string[] = [];
			for (const recipeClass of apiRequest.allowedAlternateRecipes) {
				const recipe = data.getRecipeByClassName(recipeClass);
				if (recipe) {
					let allowed = true;
					for (const machineClass of blockedMachines) {
						if (recipe.producedIn.indexOf(machineClass) !== -1) {
							allowed = false;
						}
					}
					if (allowed) {
						allowedAlts.push(recipeClass);
					}
				}
			}
			apiRequest.allowedAlternateRecipes = allowedAlts;

			const blockedRecipes: string[] = [];
			for (const recipe of data.getBaseItemRecipes()) {
				let allowed = apiRequest.blockedRecipes.indexOf(recipe.className) === -1;
				for (const machineClass of blockedMachines) {
					if (recipe.producedIn.indexOf(machineClass) !== -1) {
						allowed = false;
					}
				}
				if (!allowed) {
					blockedRecipes.push(recipe.className);
				}
			}
			apiRequest.blockedRecipes = blockedRecipes;

			delete apiRequest.blockedMachines;

			Solver.solveProduction(apiRequest, (result) => {
				const res = () => {
					let length = 0;

					for (const k in result) {
						if (!result.hasOwnProperty(k)) {
							continue;
						}

						length++;
					}

					if (!length) {
						this.resultNew = undefined;
						this.resultStatus = ResultStatus.NO_RESULT;
						return;
					}

					const factory = new ProductionResultFactory;
					this.resultNew = factory.create(apiRequest, result, DataProvider.get());
					this.resultStatus = ResultStatus.RESULT;
				};

				if ($timeout) {
					$timeout(0).then(res);
				} else {
					res();
				}
			});

		};

		if ($timeout) {
			$timeout(0).then(calc);
		} else {
			calc();
		}
	}

	public resetData(): void
	{
		this.data = {
			metadata: {
				name: null,
				icon: null,
				schemaVersion: 1,
				gameVersion: '0',
			},
			request: {
				allowedAlternateRecipes: [],
				blockedRecipes: [],
				blockedMachines: [],
				blockedResources: [],
				sinkableResources: [],
				resourceNodes: [],
				production: [],
				input: [],
				resourceMax: angular.copy(Data.resourceAmounts),
				resourceWeight: angular.copy(Data.resourceWeights),
			},
		};
	}

	get icon(): string|null
	{
		if (this.data.metadata.icon) {
			return this.data.metadata.icon;
		}
		const items = this.data.request.production.filter((item) => {
			return !!item.item;
		});
		return items.length ? items[0].item : null;
	}

	get name(): string
	{
		if (this.data.metadata.name) {
			return this.data.metadata.name;
		}
		const items = this.data.request.production.filter((item) => {
			return !!item.item;
		});
		return items.length ? (data.getItemByClassName(items[0].item || '')?.name + ' Factory') : 'Unnamed Factory';
	}

	public sinkableResourcesOrderCallback = (item: IItemSchema) => {
		return this.state.sinkableResourcesSortBy === 'name' ? item.name : item.sinkPoints;
	}

	public copyShareLink(): void
	{
		if (this.easter) {
			Strings.copyToClipboard('https://easter.ficsit.app/OptvkwO668wweaMB', 'You\'ve successfully crafted a blueprint for the broken assembly line! You may now proceed to the link that has been copied (just paste it in your browser). You can also copy this link: https://easter.ficsit.app/OptvkwO668wweaMB', 20000);
			return;
		}

		if (this.shareLink) {
			Strings.copyToClipboard(this.shareLink, 'Link for sharing has been copied to clipboard.');
			return;
		}
		const shareData = angular.copy(this.data);
		shareData.metadata.name = this.name;
		shareData.metadata.icon = this.icon;
		axios({
			method: 'POST',
			url: 'https://api.satisfactorytools.com/v2/share/?version=' + this.version,
			data: shareData,
		}).then((response) => {
			this.scope.$timeout(0).then(() => {
				this.shareLink = response.data.link;
				Strings.copyToClipboard(response.data.link, 'Link for sharing has been copied to clipboard.');
			});
		}).catch(() => {
			this.scope.$timeout(0).then(() => {
				this.shareLink = '';
				alert('Couldn\'t get the share link.');
			});
		});
	}

	public unregister(): void
	{
		this.unregisterCallback();
	}

	public addEmptyProduct(): void
	{
		this.addProduct({
			item: null,
			type: Constants.PRODUCTION_TYPE.PER_MINUTE,
			amount: 10,
			ratio: 100,
		});
	}

	public addProduct(item: IProductionDataRequestItem): void
	{
		this.data.request.production.push(item);
	}

	public cloneProduct(item: IProductionDataRequestItem): void
	{
		this.data.request.production.push({
			item: item.item,
			type: item.type,
			amount: item.amount,
			ratio: item.ratio,
		});
	}

	public clearProducts(): void
	{
		this.data.request.production = [];
		this.addEmptyProduct();
	}

	public removeProduct(item: IProductionDataRequestItem): void
	{
		const index = this.data.request.production.indexOf(item);
		if (index in this.data.request.production) {
			this.data.request.production.splice(index, 1);
		}
	}

	public addEmptyInput(): void
	{
		this.addInput({
			item: null,
			amount: 10,
		});
	}

	public addInput(item: IProductionDataRequestInput): void
	{
		this.data.request.input.push(item);
	}

	public cloneInput(item: IProductionDataRequestInput): void
	{
		this.data.request.input.push({
			item: item.item,
			amount: item.amount,
		});
	}

	public clearInput(): void
	{
		this.data.request.input = [];
		this.addEmptyInput();
	}

	public removeInput(item: IProductionDataRequestInput): void
	{
		const index = this.data.request.input.indexOf(item);
		if (index in this.data.request.input) {
			this.data.request.input.splice(index, 1);
		}
	}

	public addEmptyResourceNode(): void
	{
		this.resourceNodes.push({
			item: null,
			amount: 1,
			purity: 'pure',
			miner: null,
			overclock: 250,
		});
		this.syncResourceNodeLimits();
	}

	public cloneResourceNode(node: IProductionDataResourceNode): void
	{
		this.resourceNodes.push({
			item: node.item,
			amount: Math.max(1, parseInt(node.amount + '', 10) || 1),
			purity: this.normalizePurity(node.purity),
			miner: node.miner,
			overclock: this.normalizeOverclock(node.overclock),
		});
		this.syncResourceNodeLimits();
	}

	public clearResourceNodes(): void
	{
		this.data.request.resourceNodes = [];
		this.setDefaultRawResources();
	}

	public removeResourceNode(node: IProductionDataResourceNode): void
	{
		const index = this.resourceNodes.indexOf(node);
		if (index in this.resourceNodes) {
			this.resourceNodes.splice(index, 1);
			this.syncResourceNodeLimits();
		}
	}

	public changeResourceNodeAmount(node: IProductionDataResourceNode, delta: number): void
	{
		node.amount = Math.max(1, (parseInt(node.amount + '', 10) || 1) + delta);
		this.syncResourceNodeLimits();
	}

	public setResourceNodePurity(node: IProductionDataResourceNode, purity: RESOURCE_PURITY): void
	{
		node.purity = purity;
		this.syncResourceNodeLimits();
	}

	public setResourceNodeOverclock(node: IProductionDataResourceNode, overclock: number): void
	{
		node.overclock = overclock;
		this.syncResourceNodeLimits();
	}

	public updateResourceNode(node: IProductionDataResourceNode): void
	{
		if (node.item && !this.isMinerCompatible(node.miner, node.item)) {
			node.miner = this.getDefaultMinerClass(node.item);
		}
		this.syncResourceNodeLimits();
	}

	public get resourceNodes(): IProductionDataResourceNode[]
	{
		this.normalizeResourceNodes();
		return this.data.request.resourceNodes as IProductionDataResourceNode[];
	}

	public getAvailableMinersForNode(node: IProductionDataResourceNode): IMinerSchema[]
	{
		if (!node.item) {
			return [];
		}
		return this.getAvailableMinersForResource(node.item);
	}

	public getMinerName(className: string|null): string
	{
		switch (className) {
			case 'Build_MinerMk1_C':
			case 'Desc_MinerMk1_C':
				return 'Miner Mk.1';
			case 'Build_MinerMk2_C':
			case 'Desc_MinerMk2_C':
				return 'Miner Mk.2';
			case 'Build_MinerMk3_C':
			case 'Desc_MinerMk3_C':
				return 'Miner Mk.3';
			case 'Build_OilPump_C':
			case 'Desc_OilPump_C':
				return 'Oil Extractor';
			case 'Desc_FrackingExtractor_C':
				return 'Resource Well Extractor';
		}

		return className || 'Extractor';
	}

	public getResourceNodeRate(node: IProductionDataResourceNode): number
	{
		if (!node.item) {
			return 0;
		}
		if (!node.miner || !this.isMinerCompatible(node.miner, node.item)) {
			node.miner = this.getDefaultMinerClass(node.item);
		}
		if (!node.miner) {
			return 0;
		}

		const miner = data.getRawData().miners[node.miner];
		if (!miner) {
			return 0;
		}

		const purity = this.normalizePurity(node.purity);
		const overclock = this.normalizeOverclock(node.overclock);
		let rate = Formula.calculateExtractorExtractionValue(miner, purity) * (overclock / 100);
		if (data.getRawData().items[node.item].liquid) {
			rate /= 1000;
		}
		return rate;
	}

	public getResourceNodeTotal(node: IProductionDataResourceNode): number
	{
		return this.getResourceNodeRate(node) * Math.max(1, parseInt(node.amount + '', 10) || 1);
	}

	public setSinkableResourcesSort(sort: string)
	{
		if (this.state.sinkableResourcesSortBy === sort) {
			this.state.sinkableResourcesSortReverse = !this.state.sinkableResourcesSortReverse;
		} else {
			this.state.sinkableResourcesSortBy = sort;
			this.state.sinkableResourcesSortReverse = false;
		}
	}

	public toggleSinkableResource(className: string): void
	{
		const index = this.data.request.sinkableResources.indexOf(className);
		if (index === -1) {
			this.data.request.sinkableResources.push(className);
		} else {
			this.data.request.sinkableResources.splice(index, 1);
		}
	}

	public isSinkableResourceEnabled(className: string): boolean
	{
		return this.data.request.sinkableResources.indexOf(className) !== -1;
	}

	public toggleAlternateRecipe(className: string): void
	{
		const index = this.data.request.allowedAlternateRecipes.indexOf(className);
		if (index === -1) {
			this.data.request.allowedAlternateRecipes.push(className);
		} else {
			this.data.request.allowedAlternateRecipes.splice(index, 1);
		}
	}

	public isAlternateRecipeEnabled(className: string): boolean
	{
		return this.data.request.allowedAlternateRecipes.indexOf(className) !== -1;
	}

	public toggleBasicRecipe(className: string): void
	{
		const index = this.data.request.blockedRecipes.indexOf(className);
		if (index === -1) {
			this.data.request.blockedRecipes.push(className);
		} else {
			this.data.request.blockedRecipes.splice(index, 1);
		}
	}

	public isResourceEnabled(className: string): boolean
	{
		return this.data.request.blockedResources.indexOf(className) === -1;
	}

	public toggleResource(className: string): void
	{
		const index = this.data.request.blockedResources.indexOf(className);
		if (index === -1) {
			this.data.request.blockedResources.push(className);
		} else {
			this.data.request.blockedResources.splice(index, 1);
		}
	}

	public isBasicRecipeEnabled(className: string): boolean
	{
		return this.data.request.blockedRecipes.indexOf(className) === -1;
	}

	public isMachineEnabled(className: string): boolean
	{
		if (typeof this.data.request.blockedMachines === 'undefined') {
			return false;
		}
		return this.data.request.blockedMachines.indexOf(className) === -1;
	}

	public toggleMachine(className: string): void
	{
		if (typeof this.data.request.blockedMachines === 'undefined') {
			return;
		}
		const index = this.data.request.blockedMachines.indexOf(className);
		if (index === -1) {
			this.data.request.blockedMachines.push(className);
		} else {
			this.data.request.blockedMachines.splice(index, 1);
		}
	}

	public recipeMachineDisabled(recipe: IRecipeSchema): boolean
	{
		if (typeof this.data.request.blockedMachines === 'undefined') {
			return false;
		}
		for (const madeIn of recipe.producedIn) {
			if (this.data.request.blockedMachines.indexOf(madeIn) !== -1) {
				return true;
			}
		}
		return false;
	}

	public convertAlternateRecipeName(name: string): string
	{
		return name.replace('Alternate: ', '');
	}

	public setAllSinkableResources(value: boolean): void
	{
		if (value) {
			this.data.request.sinkableResources = data.getSinkableItems().map((item) => {
				return item.className;
			});
		} else {
			this.data.request.sinkableResources = [];
		}
	}

	public setAllBasicRecipes(value: boolean): void
	{
		if (value) {
			this.data.request.blockedRecipes = [];
		} else {
			this.data.request.blockedRecipes = data.getBaseItemRecipes().map((recipe) => {
				return recipe.className;
			});
		}
	}

	public setAllAlternateRecipes(value: boolean): void
	{
		if (value) {
			this.data.request.allowedAlternateRecipes = data.getAlternateRecipes().map((recipe) => {
				return recipe.className;
			});
		} else {
			this.data.request.allowedAlternateRecipes = [];
		}
	}

	public setDefaultRawResources(): void
	{
		this.data.request.resourceMax = angular.copy(Data.resourceAmounts);
	}

	public zeroRawResources(): void
	{
		for (const key in this.data.request.resourceMax) {
			this.data.request.resourceMax[key] = 0;
		}
	}

	private normalizeResourceNodes(): void
	{
		if (!this.data.request.resourceNodes) {
			this.data.request.resourceNodes = [];
			return;
		}

		for (const node of this.data.request.resourceNodes) {
			node.amount = Math.max(1, parseInt(node.amount + '', 10) || 1);
			node.purity = this.normalizePurity(node.purity);
			node.overclock = this.normalizeOverclock(node.overclock);
			if (node.item && !this.isMinerCompatible(node.miner, node.item)) {
				node.miner = this.getDefaultMinerClass(node.item);
			}
		}
	}

	private syncResourceNodeLimits(): void
	{
		this.normalizeResourceNodes();
		const totals: {[key: string]: number} = {};
		let hasValidNodes = false;

		for (const node of this.resourceNodes) {
			if (!node.item) {
				continue;
			}

			const total = this.getResourceNodeTotal(node);
			if (total <= 0) {
				continue;
			}

			totals[node.item] = (totals[node.item] || 0) + total;
			hasValidNodes = true;
		}

		if (!hasValidNodes) {
			return;
		}

		const defaultResources = Data.resourceAmounts as {[key: string]: number};
		for (const resource of Object.values(data.getRawData().resources)) {
			if (resource.item === Constants.WATER_CLASSNAME) {
				this.data.request.resourceMax[resource.item] = defaultResources[resource.item];
				continue;
			}

			if (this.getAvailableMinersForResource(resource.item).length) {
				this.data.request.resourceMax[resource.item] = 0;
			}
		}

		for (const item in totals) {
			this.data.request.resourceMax[item] = totals[item];
			const blockedIndex = this.data.request.blockedResources.indexOf(item);
			if (blockedIndex !== -1) {
				this.data.request.blockedResources.splice(blockedIndex, 1);
			}
		}
	}

	private normalizePurity(purity: string): RESOURCE_PURITY
	{
		return this.resourcePurities.indexOf(purity as RESOURCE_PURITY) !== -1 ? purity as RESOURCE_PURITY : 'pure';
	}

	private normalizeOverclock(overclock: number): number
	{
		return this.resourceNodeOverclockOptions.indexOf(parseInt(overclock + '', 10)) !== -1 ? parseInt(overclock + '', 10) : 250;
	}

	private getAvailableMinersForResource(item: string): IMinerSchema[]
	{
		return Object.values(data.getRawData().miners).filter((miner) => {
			return this.isMinerCompatible(miner.className, item);
		}).sort((a, b) => {
			return Formula.calculateExtractorExtractionValue(b, 'pure') - Formula.calculateExtractorExtractionValue(a, 'pure');
		});
	}

	private getDefaultMinerClass(item: string): string|null
	{
		const miners = this.getAvailableMinersForResource(item);
		return miners.length ? miners[0].className : null;
	}

	private isMinerCompatible(minerClass: string|null, item: string): boolean
	{
		if (!minerClass) {
			return false;
		}

		const miner = data.getRawData().miners[minerClass];
		if (!miner) {
			return false;
		}

		return miner.allowedResources.indexOf(item) !== -1;
	}

	public getIconSet(): string[]
	{
		const productionArray = this.data.request.production.filter((product) => {
			return !!product.item;
		}).map((product) => {
			return product.item + '';
		});
		let result = [...(Object.values(data.getAllItems())), ...(Object.values(data.getAllBuildings()))].map((entry) => {
			return entry.className;
		});
		result = [...productionArray, ...result].filter((value, index, self) => {
			return self.indexOf(value) === index;
		});
		return result;
	}

}
