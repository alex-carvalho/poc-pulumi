import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const amiId = config.require("amiId");
const instanceType = config.require("instanceType");
const name = `poc-${pulumi.getStack()}`;

const launchTemplateName = `${name}-launch-template`;
const launchTemplate = new aws.ec2.LaunchTemplate(launchTemplateName, {
    name: launchTemplateName,
    imageId: amiId,
    instanceType: instanceType,
    updateDefaultVersion: true,
});

const asgName = `${name}-asg`;
const autoScaleGroup = new aws.autoscaling.Group(asgName, {
    name: asgName,
    maxSize: 2,
    minSize: 1,
    healthCheckGracePeriod: 100,
    healthCheckType: "ELB",
    forceDelete: true,
    launchTemplate: {
        id: launchTemplate.id,
        version: "$Latest"
    },
    tags: [
        {
            key: "Name",
            value: `${name}-instance`,
            propagateAtLaunch: true
        }
    ]
}, { parent: launchTemplate });

const policyUp = new aws.autoscaling.Policy(`${name}-policy-up`, {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 300,
    autoscalingGroupName: autoScaleGroup.name,
}, { parent: autoScaleGroup });

new aws.cloudwatch.MetricAlarm(`${name}-cpu-alarm-up`, {
    name: `${name}-cpu-alarm-up`,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    evaluationPeriods: 2,
    period: 60,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    threshold: 70,
    dimensions: {
        "AutoScalingGroupName": autoScaleGroup.name
    },
    alarmActions: [policyUp.arn]

}, { parent: policyUp })


const policyDown = new aws.autoscaling.Policy(`${name}-policy-down`, {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 300,
    autoscalingGroupName: autoScaleGroup.name,
}, { parent: autoScaleGroup });


new aws.cloudwatch.MetricAlarm(`${name}-cpu-larm-down`, {
    name: `${name}-cpu-alarm-down`,
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 2,
    period: 60,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    statistic: "Average",
    threshold: 40,
    dimensions: {
        "AutoScalingGroupName": autoScaleGroup.name
    },
    alarmActions: [policyDown.arn]
}, { parent: policyDown })


const albName = `${name}-alb`
const alb = new aws.lb.LoadBalancer(albName, {
    name: albName,
    internal: false,
    loadBalancerType: "application",
}, { parent: autoScaleGroup });


const targetGroup = new aws.lb.TargetGroup(`${name}-tg`, {
    port: 8000,
    protocol: "HTTP",
    targetType: "instance",
    deregistrationDelay: 60,
    healthCheck: {
        healthyThreshold: 2,
        interval: 30,
        timeout: 10,
        protocol: "HTTP",
        matcher: "200-399",
    },
}, { parent: alb });

new aws.lb.Listener(`${name}-listener`, {
    loadBalancerArn: alb.arn,
    port: 80,
    defaultActions: [
        {
            type: "forward",
            targetGroupArn: targetGroup.arn,
        },
    ],
}, { parent: targetGroup });

new aws.autoscaling.Attachment(`${name}-alb-attachment`, {
    autoscalingGroupName: autoScaleGroup.id,
    lbTargetGroupArn: targetGroup.arn
}, { parent: targetGroup });

