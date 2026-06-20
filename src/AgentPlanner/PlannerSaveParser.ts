import {Parser} from '@etothepii/satisfactory-file-parser';
import {SaveGameStateExtractor} from '@src/AgentPlanner/SaveGameStateExtractor';
import {DataProvider} from '@src/Data/DataProvider';

export function parsePlannerSave(fileName: string, buffer: ArrayBuffer, gameVersion: string)
{
	DataProvider.change(gameVersion);
	const parsed = Parser.ParseSave(fileName.replace(/\.sav$/i, ''), buffer, {throwErrors: false});
	return new SaveGameStateExtractor().extractFromSave(parsed, fileName, gameVersion);
}
