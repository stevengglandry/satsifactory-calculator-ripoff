import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const outputDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repoRoot, 'tmp', 'gh-pages');
const publishBasePath = '/satsifactory-calculator-ripoff/';
const indexTemplatePath = path.join(repoRoot, 'www', 'index.php');
const assetBundlePath = path.join(repoRoot, 'www', 'assets', 'app.js');
const appScriptPattern = /<script src="\/assets\/app\.js\?v=<\?= filemtime\(__DIR__ \. '\/assets\/app\.js'\) \?>" async><\/script>/;
const redirect404Html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Redirecting...</title>
	<script>
		(function() {
			var pathSegmentsToKeep = 1;
			var location = window.location;
			var redirectUrl = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') +
				location.pathname.split('/').slice(0, 1 + pathSegmentsToKeep).join('/') + '/?/' +
				location.pathname.slice(1).split('/').slice(pathSegmentsToKeep).join('/').replace(/&/g, '~and~') +
				(location.search ? '&' + location.search.slice(1).replace(/&/g, '~and~') : '') +
				location.hash;
			location.replace(redirectUrl);
		})();
	</script>
</head>
<body></body>
</html>
`;

buildGitHubPages();

function buildGitHubPages(): void
{
	const appHash = crypto.createHash('sha256').update(new Uint8Array(fs.readFileSync(assetBundlePath))).digest('hex').substring(0, 7);
	const template = fs.readFileSync(indexTemplatePath, 'utf8');
	const html = template
		.replace(appScriptPattern, `<script src="/assets/app.js?v=${appHash}" async></script>`)
		.replace(/(href|src|content)="\/assets\//g, `$1="${publishBasePath}assets/`)
		.replace('<base href="/">', `<base href="${publishBasePath}">`);

	fs.rmSync(outputDir, {recursive: true, force: true});
	fs.mkdirSync(outputDir, {recursive: true});
	copyDirectory(path.join(repoRoot, 'www', 'assets'), path.join(outputDir, 'assets'));
	fs.writeFileSync(path.join(outputDir, 'index.html'), html);
	fs.writeFileSync(path.join(outputDir, '404.html'), redirect404Html);
	fs.writeFileSync(path.join(outputDir, '.nojekyll'), '\n');
}

function copyDirectory(sourceDir: string, targetDir: string): void
{
	fs.mkdirSync(targetDir, {recursive: true});
	for (const entry of fs.readdirSync(sourceDir, {withFileTypes: true})) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
		} else {
			fs.copyFileSync(sourcePath, targetPath);
		}
	}
}
