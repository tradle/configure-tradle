#!/bin/bash

set -euo pipefail
IFS=$'\n\t'
export AWS_DEFAULT_OUTPUT="json"

# COLORS: START

_red=`tput setaf 1`
_green=`tput setaf 2`
_yellow=`tput setaf 3`
_blue=`tput setaf 6`
_plain=`tput sgr0`

plain() {
  echo "${_plain}$@"
}

error() {
  echo "${_red}$@${_plain}"
}

success() {
  echo "${_green}$@${_plain}"
}

ask() {
  echo "${_green}$@${_plain}"
}

info() {
  echo "${_blue}$@${_plain}"
}

warn() {
  echo "${_yellow}$@${_plain}"
}

# COLORS: END

trim() {
  echo $1 | xargs
}

askContinue() {
  warn $@
  read -p "> " choice
  if [ "$choice" != "y" ];then exit 0; fi
}

if [ -f ".env" ]
then
  askContinue "This will overwrite your .env and .env.local files. Continue? (y/n)"
fi

if [ -f "$HOME/.aws/config" ]
then
  plain "See below your profiles from your ~/.aws/config:"
  plain ""
  cat ~/.aws/config
fi

plain ""
ask "Which AWS profile will you be using?"

read -p "> " profile
profile=${profile:-default}
profile=$(trim $profile)

info ""
info "looking up your stacks on AWS..."
stacks=$(aws --output json --profile $profile cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  | jq '.StackSummaries[].StackName' --raw-output)

plain "These are the stacks you have in AWS:"
plain ""
plain "$stacks"
plain ""
ask "Which one is your Tradle stack?"
read -p "> " stack_name

info ""
info "looking up your configuration bucket..."
bucket=$(aws --output json --profile $profile cloudformation list-stack-resources \
  --stack-name $stack_name \
  | jq '.StackResourceSummaries[] | select(.LogicalResourceId == "PrivateConfBucket").PhysicalResourceId' --raw-output)

plain ""
plain "your configuration bucket is: $bucket"

# ask "If you have a @tradle/serverless development environment, please enter the path. Otherwise hit Enter"
# read -p "> " project_dir

# if [ "$project_dir" && ! -d "$project_dir" ];
# then

# fi

cat > .env <<EOF
stack_name=$stack_name
aws_profile=$profile
bucket=$bucket
EOF

cat > .env.local <<EOF
stack_name=$stack_name
aws_profile=$profile
bucket="$stack_name-privateconfbucket"
EOF

plain ""
plain "Wrote .env and .env.local"
plain ""

warn "Would you like to load your currently deployed configuration?"
askContinue "Note: this will overwrite your local files in conf/"
plain "Pulling current versions..."
source ./scripts/load-from-s3.sh
