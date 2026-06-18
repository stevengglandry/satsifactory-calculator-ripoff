export class AppPath
{

	public static basePath(): string
	{
		const href = document.querySelector('base')?.getAttribute('href') || '/';
		if (href === '/') {
			return '/';
		}

		return href.endsWith('/') ? href : href + '/';
	}

	public static asset(relativePath: string): string
	{
		const trimmed = relativePath.replace(/^\/+/, '');
		const basePath = AppPath.basePath();
		return basePath === '/' ? '/' + trimmed : basePath + trimmed;
	}

}
