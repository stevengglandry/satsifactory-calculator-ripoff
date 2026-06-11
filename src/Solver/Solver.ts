import axios from 'axios';
import {IProductionToolResponse} from '@src/Tools/Production/IProductionToolResponse';
import {IProductionDataApiRequest} from '@src/Tools/Production/IProductionData';
import {LocalProductionSolver} from '@src/Solver/LocalProductionSolver';

export class Solver
{

	public static solveProduction(productionRequest: IProductionDataApiRequest, callback: (response: IProductionToolResponse) => void): void
	{
		if (productionRequest.gameVersion === '1.2.0') {
			try {
				callback(LocalProductionSolver.solve(productionRequest));
			} catch (e) {
				callback({});
			}
			return;
		}

		axios({
			method: 'post',
			url: 'https://api.satisfactorytools.com/v2/solver',
			data: productionRequest,
		}).then((response) => {
			if ('result' in response.data) {
				callback(response.data.result);
			}
		}).catch(() => {
			callback({});
		});
	}

}
