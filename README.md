# @tradle/models-template

fork this module to create/edit/deploy your own custom Tradle models

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Prerequisites](#prerequisites)
- [Usage](#usage)
  - [Install and load current configuration](#install-and-load-current-configuration)
  - [Customize](#customize)
    - [Custom Models](#custom-models)
    - [Custom Styles](#custom-styles)
    - [Custom Bot Configuration](#custom-bot-configuration)
    - [Custom Terms & Conditions](#custom-terms-&-conditions)
  - [Deploy](#deploy)
    - [To your local development environment](#to-your-local-development-environment)
    - [To the cloud](#to-the-cloud)
  - [Express lane](#express-lane)
- [Scripts](#scripts)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Prerequisites

- [aws-cli](https://github.com/aws/aws-cli) - AWS command line client
- [jq](https://stedolan.github.io/jq/download/) - command line JSON parser

## Usage

this assumes you already deployed Tradle MyCloud to AWS

### Install and load current configuration

1. run `npm install` in this directory
1. load your deployment information by running `npm run init`. This will create a file called `.env`

### Customize

The following sections are optional, e.g. if you don't have Custom Models, skip the custom models section. If you don't have custom styles, skip the Custom Styles section, etc.

#### Custom Models

See sample custom models in `./models-sample`. You can create your own in `./models`. Put each model in a separate json file where the file name is [yourModel.id].json (see [./models-sample/my.custom.NameForm.json](./models-sample/my.custom.NameForm.json) for an example)

Validate and build your models pack with `npm run build:models`

Note: do NOT edit `./models.json` directly as it will be overwritten by `npm run build:models`

#### Custom Styles

Define your provider's style in `./style.json` (see [./style.sample.json](./style.sample.json)). Style must adhere to the [StylesPack](https://github.com/tradle/models/tree/master/models/tradle.StylesPack.json) model.

Validate your style with `npm run build:style`

#### Custom Bot Configuration

Set your bot's configuration in `./conf/bot.json` (see [./conf/bot.sample.json](./conf/bot.sample.json)).

Validate your bot's configuration with `npm run build:botconf`

#### Custom Terms & Conditions

If you have Terms and Conditions you want your customers to accept prior to interacting with your bot, add them in `./conf/terms-and-conditions.md` (see [./conf/terms-and-conditions.sample.md](./conf/terms-and-conditions.sample.md))

### Deploy

You can deploy your configuration to your local Tradle development environment running on your machine, or to your Tradle MyCloud running in AWS.

#### To your local development environment

`npm run deploy:local`

Or if you only want to deploy a particular item:

- models: `npm run deploy:local:models`  
- styles: `npm run deploy:local:styles`  
- bot configuration: `npm run deploy:local:botconf`  
- terms and conditions: `npm run deploy:local:terms`  

#### To the cloud

`npm run deploy`

Or if you only want to deploy a particular item:

- models: `npm run deploy:models`  
- styles: `npm run deploy:styles`  
- bot configuration: `npm run deploy:botconf`  
- terms and conditions: `npm run deploy:terms`  

### Express lane

once you've customized things, you can load, build and deploy by running `npm start` and follow the wizard down the rabbit hole to nevernever land

## Scripts

- `npm run init`: set up your `.env` file, and (optionally) load your remote configuration
- `npm run mergemodels`: merges models from `./models` with values in `./values` and outputs `./models.json`
- `npm run validate`: validate your models and style
- `npm run build`: merge + validate your models, validate your style
- `npm run deploy`: deploy your models, style, bot configuration to your Tradle MyCloud's S3 bucket
- `npm run deploy:local`: deploy your models, style, bot configuration to your local Tradle development environment
- `npm run deploy:models`: deploy your models
- `npm run deploy:style`: deploy your style
- `npm start`: init, build and deploy
