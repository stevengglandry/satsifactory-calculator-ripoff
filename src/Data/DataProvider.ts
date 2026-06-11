import rawData08 from '@data/data.json';
import rawData10 from '@data/data1.0.json';
import rawData10Ficsmas from '@data/data1.0-ficsmas.json';
import rawData12 from '@data/data1.2.json';
import {IJsonSchema} from '@src/Schema/IJsonSchema';
import model from '@src/Data/Model';

export class DataProvider
{

	public static version: string;
	private static data: IJsonSchema;

	public static get(): IJsonSchema
	{
		return DataProvider.data;
	}

	public static change(version: string)
	{
		DataProvider.version = version;
		if (version === '0.8') {
			DataProvider.data = rawData08 as unknown as IJsonSchema;
		} else if (version === '1.0') {
			DataProvider.data = rawData10 as unknown as IJsonSchema;
		} else if (version === '1.0-ficsmas') {
			DataProvider.data = rawData10Ficsmas as unknown as IJsonSchema;
		} else if (version === '1.2') {
			DataProvider.data = rawData12 as unknown as IJsonSchema;
		}

		model.change(DataProvider.data);
	}

}
