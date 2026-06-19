export interface IProjectAssemblyRequirement
{
	item: string;
	name: string;
	phaseDeliveries: number[];
	absoluteTotal: number;
}

export interface IProjectAssemblyPartProgress
{
	item: string;
	name: string;
	currentStock: number;
	currentRate: number;
	directRequiredThroughPhase: number;
	directRemaining: number;
	absoluteTotal: number;
	absoluteRemaining: number;
	idealRate: number;
	capacityGap: number;
	estimatedHours: number|null;
	nextPhase: number|null;
	confidence: 'high'|'inferred'|'unknown';
}

export interface IProjectAssemblyProgress
{
	completedPhase: number;
	currentPhase: number;
	targetPhase: number|null;
	totalAbsoluteQuota: number;
	totalAbsoluteRemaining: number;
	parts: IProjectAssemblyPartProgress[];
	confidence: 'high'|'inferred'|'unknown';
	phaseSource: 'save'|'inferred';
	planningHorizonHours?: number;
	notes: string[];
}

export interface IProjectAssemblyTarget
{
	item: string;
	planLabel: 'Plan A'|'Plan B'|'Plan C';
	reason: string;
	directRemaining: number;
	absoluteRemaining: number;
	recommendedRate: number;
	currentRate: number;
	confidence: 'high'|'inferred'|'unknown';
}

export const PROJECT_ASSEMBLY_REQUIREMENTS: IProjectAssemblyRequirement[] = [
	{item: 'Desc_SpaceElevatorPart_1_C', name: 'Smart Plating', phaseDeliveries: [50, 1000, 0, 0, 0], absoluteTotal: 5550},
	{item: 'Desc_SpaceElevatorPart_3_C', name: 'Automated Wiring', phaseDeliveries: [0, 100, 0, 0, 0], absoluteTotal: 6490},
	{item: 'Desc_SpaceElevatorPart_2_C', name: 'Versatile Framework', phaseDeliveries: [0, 1000, 2500, 0, 0], absoluteTotal: 8500},
	{item: 'Desc_SpaceElevatorPart_5_C', name: 'Adaptive Control Unit', phaseDeliveries: [0, 0, 100, 0, 0], absoluteTotal: 1600},
	{item: 'Desc_SpaceElevatorPart_4_C', name: 'Modular Engine', phaseDeliveries: [0, 0, 500, 0, 0], absoluteTotal: 2250},
	{item: 'Desc_SpaceElevatorPart_7_C', name: 'Assembly Director System', phaseDeliveries: [0, 0, 0, 500, 0], absoluteTotal: 750},
	{item: 'Desc_SpaceElevatorPart_6_C', name: 'Magnetic Field Generator', phaseDeliveries: [0, 0, 0, 500, 0], absoluteTotal: 756},
	{item: 'Desc_SpaceElevatorPart_9_C', name: 'Nuclear Pasta', phaseDeliveries: [0, 0, 0, 100, 1000], absoluteTotal: 1200},
	{item: 'Desc_SpaceElevatorPart_8_C', name: 'Thermal Propulsion Rocket', phaseDeliveries: [0, 0, 0, 250, 0], absoluteTotal: 450},
	{item: 'Desc_SpaceElevatorPart_10_C', name: 'Biochemical Sculptor', phaseDeliveries: [0, 0, 0, 0, 1000], absoluteTotal: 1000},
	{item: 'Desc_SpaceElevatorPart_12_C', name: 'AI Expansion Server', phaseDeliveries: [0, 0, 0, 0, 256], absoluteTotal: 256},
	{item: 'Desc_SpaceElevatorPart_11_C', name: 'Ballistic Warp Drive', phaseDeliveries: [0, 0, 0, 0, 200], absoluteTotal: 200},
];

export const PROJECT_ASSEMBLY_TOTAL_QUOTA = PROJECT_ASSEMBLY_REQUIREMENTS.reduce((sum, requirement) => {
	return sum + requirement.absoluteTotal;
}, 0);

export function getProjectAssemblyRequirement(item: string): IProjectAssemblyRequirement|null
{
	return PROJECT_ASSEMBLY_REQUIREMENTS.find((requirement) => {
		return requirement.item === item;
	}) || null;
}
