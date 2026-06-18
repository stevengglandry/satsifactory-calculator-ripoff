import fs from 'fs';
import path from 'path';
import data from '@src/Data/Data';
import {DataProvider} from '@src/Data/DataProvider';
import {FactoryPlanner} from '@src/AgentPlanner/FactoryPlanner';
import {SaveGameStateExtractor} from '@src/AgentPlanner/SaveGameStateExtractor';
import {PROJECT_ASSEMBLY_REQUIREMENTS, PROJECT_ASSEMBLY_TOTAL_QUOTA} from '@src/AgentPlanner/ProjectAssembly';

function assert(condition: boolean, message: string): void
{
	if (!condition) {
		throw new Error(message);
	}
}

DataProvider.change('1.2');

assert(PROJECT_ASSEMBLY_TOTAL_QUOTA === 29002, 'Project Assembly absolute quota should total 29,002.');
assert(PROJECT_ASSEMBLY_REQUIREMENTS.length === 12, 'Project Assembly should include 12 project parts.');
for (const requirement of PROJECT_ASSEMBLY_REQUIREMENTS) {
	assert(!!data.getRawData().items[requirement.item], 'Missing item data for ' + requirement.item + '.');
	assert(requirement.phaseDeliveries.length === 5, requirement.item + ' should have five phase values.');
}

const extractor = new SaveGameStateExtractor();
const planner = new FactoryPlanner();
const starterState = extractor.createEmptyState('1.2');
const session = planner.createSession(starterState, '1.2');

assert(session.options.length === 3, 'Planner should create three options.');
assert(session.options[0].planLabel === 'Plan A', 'First option should be Plan A.');
assert(session.options[1].planLabel === 'Plan B', 'Second option should be Plan B.');
assert(session.options[2].planLabel === 'Plan C', 'Third option should be Plan C.');
assert(new Set(session.options.map((option) => option.targetItems[0])).size >= 3, 'Starter options should use three different project targets.');
for (const option of session.options) {
	assert(option.recommendedRate > 0, option.planLabel + ' should have a positive recommended rate.');
	assert(!!option.request.production.length, option.planLabel + ' should create calculator production data.');
	assert(option.selectedResourceNodes.length === option.cluster.nodes.length, option.planLabel + ' should expose selected nodes.');
}

const stateWithAutomatedWiring = extractor.createEmptyState('1.2');
stateWithAutomatedWiring.inventoryTotals = {
	Desc_SpaceElevatorPart_1_C: 1050,
	Desc_SpaceElevatorPart_3_C: 100,
};
stateWithAutomatedWiring.projectAssembly = null;
const progressedSession = planner.createSession(stateWithAutomatedWiring, '1.2');
assert(progressedSession.options[0].targetItems[0] !== 'Desc_SpaceElevatorPart_3_C', 'Automated Wiring should not remain Plan A after its direct need is satisfied.');

const savePath = process.argv[2];
if (!savePath) {
	console.log('Agent planner checks passed.');
} else {
	checkSaveImport(savePath).then(() => {
		console.log('Agent planner checks passed, including save import.');
	}).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}

async function checkSaveImport(filePath: string): Promise<void>
{
	const absolutePath = path.resolve(filePath);
	const bytes = Uint8Array.from(fs.readFileSync(absolutePath));
	const file = {
		name: path.basename(absolutePath),
		arrayBuffer: async () => bytes.buffer,
	} as unknown as File;
	const state = await extractor.extractFromFile(file, '1.2');
	assert(state.objectCount > 0, 'Imported save should expose parsed objects.');
	assert(state.worldResourceNodes.length > 0, 'Imported save should expose randomized resource nodes.');
	assert(state.worldResourceNodes.some((node) => node.source === 'save'), 'Imported save should use save-backed resource nodes.');
	assert(state.projectAssembly?.phaseSource === 'save', 'Imported save should expose the current phase from the save.');
	assert(Object.keys(state.productionRates).length > 0, 'Imported save should expose production capacity.');
	assert(Object.values(state.productionRates).every((entry) => entry.potentialRate > 0), 'Production capacities should be positive.');

	const importedSession = planner.createSession(state, '1.2');
	assert(importedSession.options.length === 3, 'Imported save should create three planner options.');
	for (const option of importedSession.options) {
		assert(option.candidateClusters.length === 3, option.planLabel + ' should expose three location candidates.');
		assert(option.selectedResourceNodes.length > 0, option.planLabel + ' should select save-backed resource nodes.');
	}
}
