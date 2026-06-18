import {IComponentOptions} from 'angular';
import {PlannerMapComponentController} from '@src/Module/Components/PlannerMapComponentController';

export class PlannerMapComponent implements IComponentOptions
{
	public template = '<div class="planner-map-canvas" role="application" aria-label="Interactive Satisfactory resource map"></div>';
	public controller = PlannerMapComponentController;
	public bindings = {
		mapData: '<',
		imageUrl: '<',
		factoryAreas: '<',
		routes: '<',
		filters: '<',
		onCandidateSelect: '&',
	};
}
