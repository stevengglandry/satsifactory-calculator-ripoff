import {Parser} from '@etothepii/satisfactory-file-parser';
import {SaveGameStateExtractor} from '@src/AgentPlanner/SaveGameStateExtractor';

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
		const parsed = Parser.ParseSave(request.fileName.replace(/\.sav$/i, ''), request.buffer, {throwErrors: false});
		const state = new SaveGameStateExtractor().extractFromSave(parsed, request.fileName, request.gameVersion);
		worker.postMessage({ok: true, state: state});
	} catch (error) {
		worker.postMessage({ok: false, error: error instanceof Error ? error.message : String(error)});
	}
};
