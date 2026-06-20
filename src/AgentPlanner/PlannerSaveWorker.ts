import {parsePlannerSave} from '@src/AgentPlanner/PlannerSaveParser';

interface IPlannerSaveWorkerRequest
{
	fileName: string;
	gameVersion: string;
	buffer: ArrayBuffer;
}

const worker: any = self as any;
worker.onmessage = (event: MessageEvent<IPlannerSaveWorkerRequest>) => {
	try {
		const request = event.data;
		const state = parsePlannerSave(request.fileName, request.buffer, request.gameVersion);
		worker.postMessage({ok: true, state: state});
	} catch (error) {
		worker.postMessage({ok: false, error: error instanceof Error ? error.message : String(error)});
	}
};
