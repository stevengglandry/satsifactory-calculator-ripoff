import {IItemSchema} from '@src/Schema/IItemSchema';
import {Strings} from '@src/Utils/Strings';
import parseColor from '@bin/parseDocs/color';

export default function parseItemDescriptors(items: {
	ClassName: string,
	mDisplayName: string,
	mDescription: string,
	mStackSize: string,
	mCanBeDiscarded: string,
	mRememberPickUp: string,
	mEnergyValue: string,
	mRadioactiveDecay: string,
	mResourceSinkPoints: string,
	mForm: string,
	mFluidDensity: string,
	mFluidViscosity: string,
	mFluidFriction: string,
	mFluidColor: string,
	mPersistentBigIcon: string,
	mSmallIcon?: string,
}[])
{
	const result: IItemSchema[] = [];
	for (const item of items) {
		if (!item.mDisplayName) {
			continue;
		}

		const ignored = [
			'BP_EquipmentDescriptorCandyCane_C',
			'BP_EquipmentDescriptorSnowballMittens_C',
			'Desc_CandyCane_C',
			'Desc_Gift_C',
			'Desc_Snow_C',
			'Desc_SnowballProjectile_C',
			'Desc_XmasBall1_C',
			'Desc_XmasBall2_C',
			'Desc_XmasBall3_C',
			'Desc_XmasBall4_C',
			'Desc_XmasBallCluster_C',
			'Desc_XmasBow_C',
			'Desc_XmasBranch_C',
			'Desc_XmasStar_C',
			'Desc_XmasWreath_C',
			'Desc_CandyCaneDecor_C',
			'Desc_Snowman_C',
			'Desc_WreathDecor_C',
			'Desc_XmassTree_C',
			'Desc_Fireworks_Projectile_01_C',
			'Desc_Fireworks_Projectile_02_C',
			'Desc_Fireworks_Projectile_03_C',
		];

		if (ignored.indexOf(item.ClassName) !== -1) {
			continue;
		}

		const icon = item.mPersistentBigIcon || item.mSmallIcon || 'None';
		if (icon !== 'None') {
			const liquid = item.mForm !== 'RF_SOLID';
			const fluidMultiplier = liquid ? 1000 : 1;

			result.push({
				slug: Strings.webalize(item.mDisplayName),
				className: item.ClassName,
				name: item.mDisplayName,
				sinkPoints: parseInt(item.mResourceSinkPoints || '0') * fluidMultiplier,
				description: (item.mDescription || '').replace(/\r\n/ig, '\n'),
				stackSize: Strings.stackSizeFromEnum(item.mStackSize || 'SS_ONE'),
				energyValue: parseFloat(item.mEnergyValue || '0') * fluidMultiplier,
				radioactiveDecay: parseFloat(item.mRadioactiveDecay || '0'),
				liquid: liquid,
				fluidColor: parseColor(Strings.unserializeDocs(item.mFluidColor || '(B=0,G=0,R=0,A=0)')),
			});
		}
	}
	return result;
}
