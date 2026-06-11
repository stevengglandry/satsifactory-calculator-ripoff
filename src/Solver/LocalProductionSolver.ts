import {Constants} from '@src/Constants';
import {DataProvider} from '@src/Data/DataProvider';
import {Formula} from '@src/Formula';
import {IManufacturerSchema} from '@src/Schema/IBuildingSchema';
import {IJsonSchema} from '@src/Schema/IJsonSchema';
import {IRecipeSchema} from '@src/Schema/IRecipeSchema';
import {IProductionDataApiRequest, IProductionDataApiResponse} from '@src/Tools/Production/IProductionData';

interface ILinearConstraint
{
	coefficients: number[];
	rhs: number;
}

interface ISimplexResult
{
	value: number;
	solution: number[];
}

interface IRecipeVariable
{
	index: number;
	recipe: IRecipeSchema;
	machine: IManufacturerSchema;
}

interface IMineVariable
{
	index: number;
	item: string;
	weight: number;
}

interface IInputVariable
{
	index: number;
	item: string;
	amount: number;
}

interface ISurplusVariable
{
	index: number;
	item: string;
}

interface IProductDemand
{
	fixed: {[key: string]: number};
	maximized: {[key: string]: number};
	hasMaximized: boolean;
}

export class LocalProductionSolver
{

	private static readonly EPSILON = 1e-8;
	private static readonly MAX_RESOURCE_LIMIT = 1e9;

	public static solve(request: IProductionDataApiRequest): IProductionDataApiResponse
	{
		const data = DataProvider.get();
		const demands = LocalProductionSolver.getProductDemand(request);

		if (!Object.keys(demands.fixed).length && !demands.hasMaximized) {
			return {};
		}

		let variableCount = 0;
		const recipeVariables: IRecipeVariable[] = [];
		const mineVariables: IMineVariable[] = [];
		const inputVariables: IInputVariable[] = [];
		const surplusVariables: ISurplusVariable[] = [];
		const allowedRecipes = LocalProductionSolver.getAllowedRecipes(data, request, demands);
		const relevantItems = LocalProductionSolver.getRelevantItems(demands, allowedRecipes);

		for (const recipe of allowedRecipes) {
			const machine = LocalProductionSolver.getRecipeMachine(data, recipe);
			if (!machine) {
				continue;
			}

			recipeVariables.push({
				index: variableCount++,
				recipe,
				machine,
			});
		}

		for (const resource of Object.values(data.resources)) {
			const item = resource.item;
			if (relevantItems.indexOf(item) === -1) {
				continue;
			}
			if (request.blockedResources.indexOf(item) !== -1) {
				continue;
			}
			const max = LocalProductionSolver.getResourceLimit(request, item);
			if (max <= LocalProductionSolver.EPSILON) {
				continue;
			}

			mineVariables.push({
				index: variableCount++,
				item,
				weight: request.resourceWeight[item] || 0,
			});
		}

		const inputAmounts = LocalProductionSolver.getInputAmounts(request);
		for (const item of Object.keys(inputAmounts)) {
			if (relevantItems.indexOf(item) === -1) {
				continue;
			}
			inputVariables.push({
				index: variableCount++,
				item,
				amount: inputAmounts[item],
			});
		}

		let maximizeScaleIndex: number|null = null;
		if (demands.hasMaximized) {
			maximizeScaleIndex = variableCount++;
		}

		for (const item of relevantItems) {
			surplusVariables.push({
				index: variableCount++,
				item,
			});
		}

		const equalities = LocalProductionSolver.buildBalanceConstraints(
			relevantItems,
			variableCount,
			demands,
			recipeVariables,
			mineVariables,
			inputVariables,
			surplusVariables,
			maximizeScaleIndex,
		);
		const upperBounds = LocalProductionSolver.buildUpperBounds(variableCount, request, mineVariables, inputVariables);
		const objective = LocalProductionSolver.buildObjective(variableCount, demands.hasMaximized, recipeVariables, mineVariables, surplusVariables, maximizeScaleIndex);
		const solution = LocalProductionSolver.solveLinearProgram(variableCount, equalities, upperBounds, objective);

		return LocalProductionSolver.buildResponse(solution, demands, recipeVariables, mineVariables, inputVariables, surplusVariables, maximizeScaleIndex, request);
	}

	private static getProductDemand(request: IProductionDataApiRequest): IProductDemand
	{
		const demand: IProductDemand = {
			fixed: {},
			maximized: {},
			hasMaximized: false,
		};

		for (const product of request.production) {
			if (!product.item || (product.amount <= 0 && product.type !== Constants.PRODUCTION_TYPE.MAXIMIZE)) {
				continue;
			}

			if (product.type === Constants.PRODUCTION_TYPE.MAXIMIZE) {
				const ratio = product.ratio > 0 ? product.ratio : 100;
				demand.maximized[product.item] = (demand.maximized[product.item] || 0) + ratio;
				demand.hasMaximized = true;
			} else {
				demand.fixed[product.item] = (demand.fixed[product.item] || 0) + product.amount;
			}
		}

		return demand;
	}

	private static getInputAmounts(request: IProductionDataApiRequest): {[key: string]: number}
	{
		const amounts: {[key: string]: number} = {};
		const data = DataProvider.get();

		for (const input of request.input) {
			if (!input.item || input.amount <= LocalProductionSolver.EPSILON || !(input.item in data.items)) {
				continue;
			}

			amounts[input.item] = (amounts[input.item] || 0) + input.amount;
		}

		return amounts;
	}

	private static getAllowedRecipes(data: IJsonSchema, request: IProductionDataApiRequest, demands: IProductDemand): IRecipeSchema[]
	{
		const candidates = Object.values(data.recipes).filter((recipe) => {
			if (!recipe.inMachine || recipe.forBuilding || !recipe.producedIn.length) {
				return false;
			}

			if (recipe.alternate) {
				return request.allowedAlternateRecipes.indexOf(recipe.className) !== -1;
			}

			return request.blockedRecipes.indexOf(recipe.className) === -1;
		});
		const wanted: {[key: string]: boolean} = {};
		const selected: {[key: string]: boolean} = {};
		const recipes: IRecipeSchema[] = [];

		for (const item of Object.keys(demands.fixed)) {
			wanted[item] = true;
		}
		for (const item of Object.keys(demands.maximized)) {
			wanted[item] = true;
		}

		let changed = true;
		while (changed) {
			changed = false;
			for (const recipe of candidates) {
				if (selected[recipe.className]) {
					continue;
				}
				const producesWantedItem = recipe.products.some((product) => {
					return !!wanted[product.item];
				});
				if (!producesWantedItem) {
					continue;
				}

				selected[recipe.className] = true;
				recipes.push(recipe);
				changed = true;

				for (const ingredient of recipe.ingredients) {
					wanted[ingredient.item] = true;
				}
			}
		}

		return recipes;
	}

	private static getRelevantItems(demands: IProductDemand, recipes: IRecipeSchema[]): string[]
	{
		const items: {[key: string]: boolean} = {};

		for (const item of Object.keys(demands.fixed)) {
			items[item] = true;
		}
		for (const item of Object.keys(demands.maximized)) {
			items[item] = true;
		}

		for (const recipe of recipes) {
			for (const ingredient of recipe.ingredients) {
				items[ingredient.item] = true;
			}
			for (const product of recipe.products) {
				items[product.item] = true;
			}
		}

		return Object.keys(items);
	}

	private static getRecipeMachine(data: IJsonSchema, recipe: IRecipeSchema): IManufacturerSchema|null
	{
		for (const machineClass of recipe.producedIn) {
			const building = data.buildings[machineClass] as IManufacturerSchema|undefined;
			if (!building || machineClass === Constants.WORKBENCH_CLASSNAME || machineClass === Constants.WORKSHOP_CLASSNAME) {
				continue;
			}
			if (!building.metadata || !building.metadata.manufacturingSpeed) {
				continue;
			}

			return building;
		}

		return null;
	}

	private static getResourceLimit(request: IProductionDataApiRequest, item: string): number
	{
		const limit = request.resourceMax[item] || 0;
		if (!isFinite(limit)) {
			return LocalProductionSolver.MAX_RESOURCE_LIMIT;
		}

		return Math.min(limit, LocalProductionSolver.MAX_RESOURCE_LIMIT);
	}

	private static buildBalanceConstraints(
		relevantItems: string[],
		variableCount: number,
		demands: IProductDemand,
		recipeVariables: IRecipeVariable[],
		mineVariables: IMineVariable[],
		inputVariables: IInputVariable[],
		surplusVariables: ISurplusVariable[],
		maximizeScaleIndex: number|null,
	): ILinearConstraint[] {
		const constraints: ILinearConstraint[] = [];
		const surplusByItem: {[key: string]: number} = {};

		for (const variable of surplusVariables) {
			surplusByItem[variable.item] = variable.index;
		}

		for (const item of relevantItems) {
			const coefficients = new Array(variableCount).fill(0) as number[];

			for (const variable of recipeVariables) {
				for (const product of variable.recipe.products) {
					if (product.item === item) {
						coefficients[variable.index] += Formula.calculateProductAmountsPerMinute(variable.machine, variable.recipe, product.amount, 100);
					}
				}
				for (const ingredient of variable.recipe.ingredients) {
					if (ingredient.item === item) {
						coefficients[variable.index] -= Formula.calculateProductAmountsPerMinute(variable.machine, variable.recipe, ingredient.amount, 100);
					}
				}
			}

			for (const variable of mineVariables) {
				if (variable.item === item) {
					coefficients[variable.index] += 1;
				}
			}

			for (const variable of inputVariables) {
				if (variable.item === item) {
					coefficients[variable.index] += 1;
				}
			}

			if (maximizeScaleIndex !== null && item in demands.maximized) {
				coefficients[maximizeScaleIndex] -= demands.maximized[item];
			}

			coefficients[surplusByItem[item]] -= 1;

			const rhs = demands.fixed[item] || 0;
			const hasCoefficient = coefficients.some((coefficient) => Math.abs(coefficient) > LocalProductionSolver.EPSILON);
			if (hasCoefficient || rhs > LocalProductionSolver.EPSILON) {
				const normalized = LocalProductionSolver.normalizeEquality(coefficients, rhs);
				constraints.push(normalized);
			}
		}

		return constraints;
	}

	private static buildUpperBounds(
		variableCount: number,
		request: IProductionDataApiRequest,
		mineVariables: IMineVariable[],
		inputVariables: IInputVariable[],
	): ILinearConstraint[] {
		const constraints: ILinearConstraint[] = [];

		for (const variable of mineVariables) {
			const coefficients = new Array(variableCount).fill(0) as number[];
			coefficients[variable.index] = 1;
			constraints.push({
				coefficients,
				rhs: LocalProductionSolver.getResourceLimit(request, variable.item),
			});
		}

		for (const variable of inputVariables) {
			const coefficients = new Array(variableCount).fill(0) as number[];
			coefficients[variable.index] = 1;
			constraints.push({
				coefficients,
				rhs: variable.amount,
			});
		}

		return constraints;
	}

	private static buildObjective(
		variableCount: number,
		hasMaximizedProducts: boolean,
		recipeVariables: IRecipeVariable[],
		mineVariables: IMineVariable[],
		surplusVariables: ISurplusVariable[],
		maximizeScaleIndex: number|null,
	): number[] {
		const objective = new Array(variableCount).fill(0) as number[];
		const resourcePenalty = hasMaximizedProducts ? 1e-7 : 1;
		const recipePenalty = hasMaximizedProducts ? 1e-10 : 1e-6;
		const surplusPenalty = hasMaximizedProducts ? 1e-10 : 1e-7;

		if (maximizeScaleIndex !== null) {
			objective[maximizeScaleIndex] = 1;
		}

		for (const variable of mineVariables) {
			objective[variable.index] -= variable.weight * resourcePenalty;
		}

		for (const variable of recipeVariables) {
			objective[variable.index] -= recipePenalty;
		}

		for (const variable of surplusVariables) {
			objective[variable.index] -= surplusPenalty;
		}

		return objective;
	}

	private static normalizeEquality(coefficients: number[], rhs: number): ILinearConstraint
	{
		if (rhs >= 0) {
			return {coefficients, rhs};
		}

		return {
			coefficients: coefficients.map((coefficient) => -coefficient),
			rhs: -rhs,
		};
	}

	private static solveLinearProgram(
		variableCount: number,
		equalities: ILinearConstraint[],
		upperBounds: ILinearConstraint[],
		objective: number[],
	): number[] {
		const result = LocalProductionSolver.solveSimplex(variableCount, equalities, upperBounds, objective);
		return result.solution.slice(0, variableCount);
	}

	private static solveSimplex(
		originalVariableCount: number,
		equalities: ILinearConstraint[],
		upperBounds: ILinearConstraint[],
		objective: number[],
	): ISimplexResult {
		const artificialOffset = originalVariableCount + upperBounds.length;
		const totalVariableCount = originalVariableCount + upperBounds.length + equalities.length;
		const rhsColumn = totalVariableCount;
		const rows: number[][] = [];
		const basis: number[] = [];

		for (let i = 0; i < upperBounds.length; i++) {
			const row = new Array(totalVariableCount + 1).fill(0) as number[];
			for (let j = 0; j < originalVariableCount; j++) {
				row[j] = upperBounds[i].coefficients[j] || 0;
			}
			row[originalVariableCount + i] = 1;
			row[rhsColumn] = Math.max(0, upperBounds[i].rhs);
			rows.push(row);
			basis.push(originalVariableCount + i);
		}

		for (let i = 0; i < equalities.length; i++) {
			const row = new Array(totalVariableCount + 1).fill(0) as number[];
			for (let j = 0; j < originalVariableCount; j++) {
				row[j] = equalities[i].coefficients[j] || 0;
			}
			row[artificialOffset + i] = 1;
			row[rhsColumn] = equalities[i].rhs;
			rows.push(row);
			basis.push(artificialOffset + i);
		}

		const phaseOneObjective = new Array(totalVariableCount).fill(0) as number[];
		for (let i = artificialOffset; i < totalVariableCount; i++) {
			phaseOneObjective[i] = -1;
		}

		const phaseOne = LocalProductionSolver.optimize(rows, basis, phaseOneObjective);
		if (phaseOne.value < -LocalProductionSolver.EPSILON) {
			throw new Error('No feasible production plan found.');
		}
		for (let i = artificialOffset; i < totalVariableCount; i++) {
			if ((phaseOne.solution[i] || 0) > 1e-6) {
				throw new Error('No feasible production plan found.');
			}
		}

		const phaseTwoObjective = new Array(totalVariableCount).fill(0) as number[];
		for (let i = 0; i < objective.length; i++) {
			phaseTwoObjective[i] = objective[i];
		}
		for (let i = artificialOffset; i < totalVariableCount; i++) {
			phaseTwoObjective[i] = -1e9;
		}

		const phaseTwo = LocalProductionSolver.optimize(rows, basis, phaseTwoObjective);
		for (let i = artificialOffset; i < totalVariableCount; i++) {
			if ((phaseTwo.solution[i] || 0) > 1e-6) {
				throw new Error('No feasible production plan found.');
			}
		}

		return phaseTwo;
	}

	private static optimize(rows: number[][], basis: number[], objective: number[]): ISimplexResult
	{
		const columnCount = rows.length ? rows[0].length : objective.length + 1;
		const rhsColumn = columnCount - 1;
		const objectiveRow = new Array(columnCount).fill(0) as number[];

		for (let j = 0; j < objective.length; j++) {
			objectiveRow[j] = -objective[j];
		}

		for (let i = 0; i < rows.length; i++) {
			const basisCost = objective[basis[i]] || 0;
			if (Math.abs(basisCost) <= LocalProductionSolver.EPSILON) {
				continue;
			}
			for (let j = 0; j < columnCount; j++) {
				objectiveRow[j] += basisCost * rows[i][j];
			}
		}

		for (let iteration = 0; iteration < 10000; iteration++) {
			const entering = LocalProductionSolver.getEnteringColumn(objectiveRow);
			if (entering === -1) {
				const solution = new Array(objective.length).fill(0) as number[];
				for (let i = 0; i < rows.length; i++) {
					if (basis[i] < solution.length) {
						solution[basis[i]] = rows[i][rhsColumn];
					}
				}

				return {
					value: objectiveRow[rhsColumn],
					solution,
				};
			}

			const leaving = LocalProductionSolver.getLeavingRow(rows, basis, entering, rhsColumn);
			if (leaving === -1) {
				throw new Error('Production plan is unbounded.');
			}

			LocalProductionSolver.pivot(rows, objectiveRow, basis, leaving, entering);
		}

		throw new Error('Production solver iteration limit reached.');
	}

	private static getEnteringColumn(objectiveRow: number[]): number
	{
		for (let j = 0; j < objectiveRow.length - 1; j++) {
			if (objectiveRow[j] < -LocalProductionSolver.EPSILON) {
				return j;
			}
		}

		return -1;
	}

	private static getLeavingRow(rows: number[][], basis: number[], entering: number, rhsColumn: number): number
	{
		let leaving = -1;
		let bestRatio = Number.POSITIVE_INFINITY;

		for (let i = 0; i < rows.length; i++) {
			const coefficient = rows[i][entering];
			if (coefficient <= LocalProductionSolver.EPSILON) {
				continue;
			}

			const ratio = rows[i][rhsColumn] / coefficient;
			if (ratio < bestRatio - LocalProductionSolver.EPSILON) {
				bestRatio = ratio;
				leaving = i;
			} else if (Math.abs(ratio - bestRatio) <= LocalProductionSolver.EPSILON && (leaving === -1 || basis[i] < basis[leaving])) {
				leaving = i;
			}
		}

		return leaving;
	}

	private static pivot(rows: number[][], objectiveRow: number[], basis: number[], leaving: number, entering: number): void
	{
		const pivotValue = rows[leaving][entering];
		for (let j = 0; j < rows[leaving].length; j++) {
			rows[leaving][j] /= pivotValue;
		}

		for (let i = 0; i < rows.length; i++) {
			if (i === leaving) {
				continue;
			}

			const factor = rows[i][entering];
			if (Math.abs(factor) <= LocalProductionSolver.EPSILON) {
				continue;
			}

			for (let j = 0; j < rows[i].length; j++) {
				rows[i][j] -= factor * rows[leaving][j];
			}
		}

		const objectiveFactor = objectiveRow[entering];
		for (let j = 0; j < objectiveRow.length; j++) {
			objectiveRow[j] -= objectiveFactor * rows[leaving][j];
		}

		basis[leaving] = entering;
	}

	private static buildResponse(
		solution: number[],
		demands: IProductDemand,
		recipeVariables: IRecipeVariable[],
		mineVariables: IMineVariable[],
		inputVariables: IInputVariable[],
		surplusVariables: ISurplusVariable[],
		maximizeScaleIndex: number|null,
		request: IProductionDataApiRequest,
	): IProductionDataApiResponse {
		const response: IProductionDataApiResponse = {};

		for (const variable of mineVariables) {
			LocalProductionSolver.addResponseAmount(response, variable.item + '#Mine', solution[variable.index]);
		}

		for (const variable of inputVariables) {
			LocalProductionSolver.addResponseAmount(response, variable.item + '#Input', solution[variable.index]);
		}

		for (const variable of recipeVariables) {
			LocalProductionSolver.addResponseAmount(response, variable.recipe.className + '@100#' + variable.machine.className, solution[variable.index]);
		}

		for (const item of Object.keys(demands.fixed)) {
			LocalProductionSolver.addResponseAmount(response, item + '#Product', demands.fixed[item]);
		}

		if (maximizeScaleIndex !== null) {
			const scale = solution[maximizeScaleIndex] || 0;
			for (const item of Object.keys(demands.maximized)) {
				LocalProductionSolver.addResponseAmount(response, item + '#Product', demands.maximized[item] * scale);
			}
		}

		for (const variable of surplusVariables) {
			const amount = solution[variable.index] || 0;
			if (amount <= LocalProductionSolver.EPSILON) {
				continue;
			}

			const key = request.sinkableResources.indexOf(variable.item) !== -1 ? variable.item + '#Sink' : variable.item + '#Byproduct';
			LocalProductionSolver.addResponseAmount(response, key, amount);
		}

		return response;
	}

	private static addResponseAmount(response: IProductionDataApiResponse, key: string, amount: number): void
	{
		if (!isFinite(amount) || amount <= LocalProductionSolver.EPSILON) {
			return;
		}

		const current = response[key] || 0;
		response[key] = parseFloat((current + amount).toPrecision(12));
	}

}
