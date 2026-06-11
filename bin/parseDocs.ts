import * as fs from 'fs';
import * as path from 'path';
import {IJsonSchema} from '@src/Schema/IJsonSchema';
import {IItemSchema} from '@src/Schema/IItemSchema';
import parseItemDescriptors from '@bin/parseDocs/itemDescriptor';
import parseRecipes from '@bin/parseDocs/recipe';
import parseResourceDescriptors from '@bin/parseDocs/resourceDescriptor';
import parseBuildings from '@bin/parseDocs/building';
import parseResourceExtractors from '@bin/parseDocs/resourceExtractor';
import parseGenerators from '@bin/parseDocs/generator';
import parseBuildingDescriptors from '@bin/parseDocs/buildingDescriptor';
import parseSchematics from '@bin/parseDocs/schematic';
import {Objects} from '@src/Utils/Objects';
import {DiffGenerator} from '@src/Utils/DiffGenerator/DiffGenerator';
import {DiffFormatter} from '@src/Utils/DiffGenerator/DiffFormatter';
import parseImageMapping from '@bin/parseDocs/imageMapping';
import {Strings} from '@src/Utils/Strings';

function readJsonText(filePath: string): string
{
	const buffer = fs.readFileSync(filePath);
	const content = buffer[0] === 0xff && buffer[1] === 0xfe
		? buffer.toString('utf16le')
		: buffer.toString('utf8');

	return content.replace(/^\uFEFF/, '');
}

function nativeClassName(nativeClass: string): string
{
	const match = nativeClass.match(/\/Script\/FactoryGame\.([A-Za-z0-9_]+)/);
	if (match) {
		return match[1];
	}

	return nativeClass.replace(/^Class'\/Script\/FactoryGame\./, '').replace(/'$/, '');
}

function isItemDescriptor(nativeClass: string): boolean
{
	return [
		'FGItemDescriptor',
		'FGEquipmentDescriptor',
		'FGConsumableDescriptor',
		'FGItemDescriptorNuclearFuel',
		'FGItemDescAmmoTypeProjectile',
		'FGItemDescAmmoTypeColorCartridge',
		'FGItemDescAmmoTypeInstantHit',
		'FGAmmoTypeProjectile',
		'FGAmmoTypeSpreadshot',
		'FGAmmoTypeInstantHit',
		'FGConsumableEquipment',
		'FGEquipmentStunSpear',
		'FGObjectScanner',
		'FGWeapon',
		'FGGasMask',
		'FGSuitBase',
		'FGJetPack',
		'FGChargedWeapon',
		'FGChainsaw',
		'FGParachute',
		'FGJumpingStilts',
		'FGEquipmentZipline',
		'FGHoverPack',
		'FGPowerShardDescriptor',
		'FGItemDescriptorPowerBoosterFuel',
	].indexOf(nativeClass) !== -1 || nativeClass.indexOf('FGItemDescriptor') === 0;
}

function isBuildable(nativeClass: string): boolean
{
	return nativeClass.indexOf('FGBuildable') === 0 || [
		'FGConveyorPoleStackable',
		'FGPipeHyperStart',
		'FGVehicleDescriptor',
		'FGGolfCartDispenser',
		'FGPortableMinerDispenser',
		'FGVehiclePathSegment',
	].indexOf(nativeClass) !== -1;
}

const docsPath = process.env.DOCS_PATH ? path.resolve(process.env.DOCS_PATH) : path.join(__dirname, '..', 'data', 'Docs.json');
const oldDataPath = process.env.OLD_DATA_PATH ? path.resolve(process.env.OLD_DATA_PATH) : path.join(__dirname, '..', 'data', 'data.json');
const outputDataPath = process.env.OUTPUT_DATA_PATH ? path.resolve(process.env.OUTPUT_DATA_PATH) : path.join(__dirname, '..', 'data', 'data.json');

const docs = JSON.parse(readJsonText(docsPath));
const oldData: IJsonSchema = JSON.parse(readJsonText(oldDataPath)) as IJsonSchema;
//const sizes: {Name: string, Dimensions: number[]}[] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debug.json')).toString()) as {Name: string, Dimensions: number[]}[];

const json: IJsonSchema = {
	recipes: {},
	items: {},
	schematics: {},
	generators: {},
	resources: {},
	miners: {},
	buildings: {},
};

let biomass: IItemSchema[] = [];
let extraInfo: any[] = [];
let imageMapping: { [key: string]: string } = {};

for (const definitions of docs) {
	const nativeClass = nativeClassName(definitions.NativeClass);

	switch (nativeClass) {
		case 'FGItemDescriptor':
		case 'FGEquipmentDescriptor':
		case 'FGConsumableDescriptor':
		case 'FGItemDescriptorNuclearFuel':
		case 'FGItemDescAmmoTypeProjectile':
		case 'FGItemDescAmmoTypeColorCartridge':
		case 'FGItemDescAmmoTypeInstantHit':
		case 'FGAmmoTypeProjectile':
		case 'FGAmmoTypeSpreadshot':
		case 'FGAmmoTypeInstantHit':
			for (const item of parseItemDescriptors(definitions.Classes)) {
				json.items[item.className] = item;
			}
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			break;
		case 'FGRecipe':
			for (const recipe of parseRecipes(definitions.Classes)) {
				json.recipes[recipe.className] = recipe;
			}
			break;
		case 'FGResourceDescriptor':
			for (const item of parseItemDescriptors(definitions.Classes)) {
				json.items[item.className] = item;
			}
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			for (const resource of parseResourceDescriptors(definitions.Classes)) {
				json.resources[resource.item] = resource;
			}
			break;
		case 'FGItemDescriptorBiomass':
			biomass = parseItemDescriptors(definitions.Classes);
			for (const item of biomass) {
				json.items[item.className] = item;
			}
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			break;
		case 'FGBuildableResourceExtractor':
			for (const building of parseBuildings(definitions.Classes, true)) {
				json.buildings[building.className] = building;
			}
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			for (const miner of parseResourceExtractors(definitions.Classes)) {
				json.miners[miner.className] = miner;
			}
			break;
		case 'FGBuildableGeneratorFuel':
		case 'FGBuildableGeneratorNuclear':
		case 'FGBuildableGeneratorGeoThermal':
			for (const building of parseBuildings(definitions.Classes, true)) {
				json.buildings[building.className] = building;
			}
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			for (const generator of parseGenerators(definitions.Classes)) {
				json.generators[generator.className] = generator;
			}
			break;
		case 'FGBuildingDescriptor':
			extraInfo = parseBuildingDescriptors(definitions.Classes);
			for (const item of parseImageMapping(definitions.Classes)) {
				imageMapping[item.className] = item.image;
			}
			break;
		case 'FGSchematic':
			for (const schematic of parseSchematics(definitions.Classes)) {
				json.schematics[schematic.className] = schematic;
			}
			for (const schematic of parseImageMapping(definitions.Classes)) {
				imageMapping[schematic.className] = schematic.image;
			}
			break;
		default:
			if (isItemDescriptor(nativeClass)) {
				for (const item of parseItemDescriptors(definitions.Classes)) {
					json.items[item.className] = item;
				}
				for (const item of parseImageMapping(definitions.Classes)) {
					imageMapping[item.className] = item.image;
				}
				break;
			}
			if (isBuildable(nativeClass)) {
				for (const building of parseBuildings(definitions.Classes, true)) {
					json.buildings[building.className] = building;
				}
				for (const item of parseImageMapping(definitions.Classes)) {
					imageMapping[item.className] = item.image;
				}
				break;
			}
			// console.log(definitions.NativeClass);
			break;
	}
}

const vehicleMapping: {
	key: string,
	name: string,
	description: string,
}[] = [
	{
		key: 'Desc_Truck_C',
		name: 'Truck',
		description: '48 slot inventory. Has a built in Craft Bench. Can be automated to pick up and deliver resources at Truck Stations. Nicknamed the Unit by FICSIT pioneers because of its massive frame.',
	},
	{
		key: 'Desc_Tractor_C',
		name: 'Tractor',
		description: '25 slot inventory. Has a built in Craft Bench. Can be automated to pick up and deliver resources at Truck Stations. Nicknamed the Sugarcube by FICSIT pioneers.',
	},
	{
		key: 'Desc_FreightWagon_C',
		name: 'Freight Car',
		description: 'The Freight Car is used to transport large quantity of resources from one place to another. Resources are loaded or unloaded at Freight Platforms.\nMust be build on Railway.',
	},
	{
		key: 'Desc_Locomotive_C',
		name: 'Electric Locomotive',
		description: 'This locomotive is used to move Freight Cars from station to station.\nRequires 25-110MW of Power to drive.\nMust be built on railway.\nNamed \'Leif\' by FISCIT pioneers because of its reliability.',
	},
	{
		key: 'Desc_Explorer_C',
		name: 'Explorer',
		description: '24 slot inventory. Has a built in craft bench. Fast and nimble exploration vehicle. Tuned for really rough terrain and can climb almost vertical surfaces.',
	},
	{
		key: 'Desc_CyberWagon_C',
		name: 'Cyber Wagon',
		description: 'Absolutely indestructible.\nNeeds no further introduction.',
	},
	{
		key: 'Desc_DroneTransport_C',
		name: 'Drone',
		description: '',
	},
];

for (const item of vehicleMapping) {
	if (json.buildings[item.key]) {
		json.buildings[item.key].name = item.name;
		json.buildings[item.key].description = item.description;
		json.buildings[item.key].slug = Strings.webalize(item.name);
	}
}

// add building sizes
/*for (const item of sizes) {
	for (const key in json.buildings) {
		if (item.Name.replace('Build_', 'Desc_') === json.buildings[key].className) {
			json.buildings[key].size = {
				width: item.Dimensions[0] * 0.02,
				length: item.Dimensions[1] * 0.02,
				height: item.Dimensions[2] * 0.02,
			};
		}
	}
}*/

// add extra info to buildings
for (const info of extraInfo) {
	if (info.className in json.buildings) {
		json.buildings[info.className].buildMenuPriority = info.priority;
		json.buildings[info.className].categories = info.categories;
	} else {
		console.log(info.className);
	}
}

// add coupon item
json.items['Desc_ResourceSinkCoupon_C'] = {
	className: 'Desc_ResourceSinkCoupon_C',
	description: 'A special FICSIT bonus program Coupon, obtained through the AWESOME Sink. Can be redeemed in the AWESOME Shop for bonus milestones and rewards',
	energyValue: 0,
	fluidColor: {
		r: 0,
		g: 0,
		b: 0,
		a: 0,
	},
	liquid: false,
	name: 'FICSIT Coupon',
	radioactiveDecay: 0,
	sinkPoints: 1,
	slug: 'ficsit-coupon',
	stackSize: 500,
};
imageMapping['Desc_ResourceSinkCoupon_C'] = '/Game/FactoryGame/Resource/Parts/ResourceSinkCoupon/UI/IconDesc_Ficsit_Coupon_256.png';

// add biomass stuff to biomass burner
for (const key in json.generators) {
	const index = json.generators[key].fuel.indexOf('FGItemDescriptorBiomass');
	if (index !== -1) {
		json.generators[key].fuel.splice(index, 1);
		json.generators[key].fuel.push(...biomass.map((bio) => {
			return bio.className;
		}));
	}
}

// convert liquid requirements to m3
for (const key in json.recipes) {
	const recipe = json.recipes[key];

	for (const ingredient of recipe.ingredients) {
		if (!json.items[ingredient.item]) {
			throw new Error('Invalid item ' + ingredient.item + ' (' + key + ')');
		}
		if (json.items[ingredient.item].liquid) {
			ingredient.amount /= 1000;
		}
	}
	for (const product of recipe.products) {
		if (!json.items[product.item]) {
			continue;
		}
		if (json.items[product.item].liquid) {
			product.amount /= 1000;
		}
	}
}

// attach extractable resources instead of keeping empty array with "everything allowed"
for (const minerKey in json.miners) {
	if (json.miners[minerKey].allowedResources.length > 0) {
		continue;
	}

	const allowedResources = [] as string[];
	for (const resourceKey in json.resources) {
		if (!json.items[resourceKey]) {
			throw new Error(`Item of resource type "${resourceKey}" was not found.`);
		}

		const item = json.items[resourceKey];

		if (item.liquid === json.miners[minerKey].allowLiquids) {
			allowedResources.push(resourceKey);
		}
	}

	allowedResources.sort();
	json.miners[minerKey].allowedResources = allowedResources;
}

for (const key in json) {
	if (json.hasOwnProperty(key)) {
		json[key as keyof IJsonSchema] = Objects.sortByKeys(json[key as keyof IJsonSchema]);
	}
}

const slugs: string[] = [];
for (const key in json.items) {
	let slug = json.items[key].slug;
	let i = 1;
	while (slugs.indexOf(slug) !== -1) {
		slug = json.items[key].slug + '-' + i++;
	}
	json.items[key].slug = slug;
	slugs.push(slug);
}
for (const key in json.buildings) {
	let slug = json.buildings[key].slug;
	let i = 1;
	while (slugs.indexOf(slug) !== -1) {
		slug = json.buildings[key].slug + '-' + i++;
	}
	json.buildings[key].slug = slug;
	slugs.push(slug);
}
for (const key in json.schematics) {
	let slug = json.schematics[key].slug;
	let i = 1;
	while (slugs.indexOf(slug) !== -1) {
		slug = json.schematics[key].slug + '-' + i++;
	}
	json.schematics[key].slug = slug;
	slugs.push(slug);
}

fs.writeFileSync(outputDataPath, JSON.stringify(json, null, '\t') + '\n');

const diffGenerator = new DiffGenerator();
fs.writeFileSync(path.join(__dirname, '..', 'data', 'diff.txt'), DiffFormatter.diffToMarkdown(diffGenerator.generateDiff(oldData, json)));

fs.writeFileSync(path.join(__dirname, '..', 'data', 'imageMapping.json'), JSON.stringify(imageMapping, null, '\t') + '\n');
