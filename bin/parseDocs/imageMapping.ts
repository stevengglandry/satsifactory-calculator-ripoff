import {Strings} from '@src/Utils/Strings';

export default function parseImageMapping(value: {
	ClassName: string
	mPersistentBigIcon?: string;
	mSchematicIcon?: string;
}[]): {
	className: string,
	image: string,
}[]
{
	const result = [];
	for (const item of value) {
		const icon = item.mPersistentBigIcon || (item as any).mSmallIcon;
		if (icon && icon !== 'None') {
			result.push({
				className: item.ClassName,
				image: icon.replace('Texture2D /', '').replace(/\..*/, '.png'),
			});
		}

		if (item.mSchematicIcon) {
			const iconData = Strings.unserializeDocs(item.mSchematicIcon);
			if (iconData.ResourceObject) {
				result.push({
					className: item.ClassName,
					image: iconData.ResourceObject.replace('\'', '').replace('"', '').replace('Texture2D/', '').replace(/\..*/, '.png'),
				})
			}
		}
	}
	return result;
}
