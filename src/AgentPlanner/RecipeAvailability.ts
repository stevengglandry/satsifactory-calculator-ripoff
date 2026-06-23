import data from '@src/Data/Data';
import {IAgentGameState} from '@src/AgentPlanner/Types';
import {isSamResourceConversion} from '@src/AgentPlanner/RecipePolicy';

export interface IPlannerRecipeContext
{
	saveName: string;
	saveSnapshotId: string;
	parsedAt: string;
	allowedAlternateRecipes: string[];
}

export function getPlannerRecipeContextStorageKey(version: string): string
{
	return 'plannerRecipeContext-' + version;
}

export function getUnlockedAlternateRecipes(state: IAgentGameState): string[]
{
	return normalizeAllowedAlternateRecipes(state.availableRecipes || []);
}

export function createPlannerRecipeContext(state: IAgentGameState, saveSnapshotId: string): IPlannerRecipeContext
{
	return {
		saveName: state.saveName,
		saveSnapshotId: saveSnapshotId,
		parsedAt: state.parsedAt,
		allowedAlternateRecipes: getUnlockedAlternateRecipes(state),
	};
}

export function normalizeAllowedAlternateRecipes(classNames: string[]): string[]
{
	const rawData = data.getRawData();
	const result: {[className: string]: boolean} = {};
	for (const className of classNames || []) {
		const recipe = rawData.recipes[className];
		if (recipe && recipe.alternate && !isSamResourceConversion(recipe)) {
			result[className] = true;
		}
	}
	return Object.keys(result).sort();
}
