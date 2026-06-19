const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');
const path = require('path');

module.exports = {
	mode: 'development',
	entry: {
		app: './src/app.ts',
		'planner-save-worker': './src/AgentPlanner/PlannerSaveWorker.ts',
	},
	output: {
		path: path.resolve(__dirname, 'www/assets'),
		filename: '[name].js'
	},
	plugins: [
		new webpack.IgnorePlugin({
			resourceRegExp: /(fs|child_process)/
		}),
		new ESLintPlugin({
			extensions: ['ts', 'tsx'],
			eslintPath: require.resolve('eslint'),
			overrideConfigFile: '.eslintrc.js',
		}),
	],
	resolve: {
		alias: {
			'stream/web': require.resolve('web-streams-polyfill'),
		},
		plugins: [
			new TsconfigPathsPlugin,
		],
		extensions: ['.ts', '.tsx', '.js'],
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: [
					{
						loader: 'ts-loader',
					},
				],
				exclude: '/node_modules/',
			},
			{
				test: /\.html$/,
				use: [
					{
						loader: 'angular-templatecache-loader?module=app',
					},
				],
			},
			{
				test: /\.css$/i,
				use: ['style-loader', 'css-loader'],
			},
			{
				test: /\.(png|jpg|gif)$/i,
				type: 'asset/inline',
			},
			{
				test: /\.scss$/,
				use: ['style-loader', 'css-loader', 'sass-loader'],
			},
		],
	},
	performance: {
		hints: false,
	},
	optimization: {
		minimizer: [
			new TerserPlugin({
				extractComments: false,
			}),
		],
	},
};
