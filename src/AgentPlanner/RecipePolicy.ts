import data from '@src/Data/Data';
import {IRecipeSchema} from '@src/Schema/IRecipeSchema';

export const SAM_RESOURCE_CONVERSION_RECIPES = [
	'Recipe_Bauxite_Caterium_C',
	'Recipe_Bauxite_Copper_C',
	'Recipe_Caterium_Copper_C',
	'Recipe_Caterium_Quartz_C',
	'Recipe_Coal_Iron_C',
	'Recipe_Coal_Limestone_C',
	'Recipe_Copper_Quartz_C',
	'Recipe_Copper_Sulfur_C',
	'Recipe_Iron_Limestone_C',
	'Recipe_Limestone_Sulfur_C',
	'Recipe_Nitrogen_Bauxite_C',
	'Recipe_Nitrogen_Caterium_C',
	'Recipe_Quartz_Bauxite_C',
	'Recipe_Quartz_Coal_C',
	'Recipe_Sulfur_Coal_C',
	'Recipe_Sulfur_Iron_C',
	'Recipe_Uranium_Bauxite_C',
];

export function isSamResourceConversion(recipe: IRecipeSchema|string): boolean
{
	const recipeClassName = typeof recipe === 'string' ? recipe : recipe.className;
	return SAM_RESOURCE_CONVERSION_RECIPES.indexOf(recipeClassName) !== -1;
}

export function getDefaultBlockedRecipes(): string[]
{
	return SAM_RESOURCE_CONVERSION_RECIPES.filter((className) => !!data.getRawData().recipes[className]);
}
