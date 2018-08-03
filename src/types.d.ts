import { Conf } from './'

export { Conf }

export type AWSClients = {
  s3: AWS.S3
  dynamodb: AWS.DynamoDB
  iot: AWS.Iot
  iotData: AWS.IotData
  sts: AWS.STS
  sns: AWS.SNS
  ses: AWS.SES
  kms: AWS.KMS
  docClient: AWS.DynamoDB.DocumentClient
  lambda: AWS.Lambda
  cloudformation: AWS.CloudFormation
  xray: AWS.XRay
  apigateway: AWS.APIGateway
  // autoscaling: AWS.AutoScaling
  applicationAutoScaling: AWS.ApplicationAutoScaling
  AWS: any
  trace: any
}

export type NodeFlags = {
  inspect?: boolean
  ['inspect-brk']?: boolean
  debug?: boolean
  ['debug-brk']?: boolean
}

export type ConfOpts = {
  // client: AWSClients
  region?: string
  profile?: string
  stackName?: string
  stackId?: string
  namespace?: string
  local?: boolean
  remote?: boolean
  project?: string
  nodeFlags?: NodeFlags
}

export interface UpdateOpts {
  stackName: string
  tag: string
  provider?: string
  showReleaseCandidates?: boolean
  force?: boolean
  rollback?: boolean
}

export interface VersionInfo {
  tag: string
  sortableTag: string
  templateUrl?: string
}

export type InvokeOpts = {
  functionName: string
  arg?: any
  noWarning?: boolean
}

export type WaitStackOpts = {
  stackName: string
}

export interface GetUpdateInfoResp {
  update: VersionInfo
  upToDate: boolean
}

export interface ApplyUpdateOpts {
  templateUrl: string
  notificationTopics?: string[]
}
