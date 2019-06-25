'use strict';

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'});
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

exports.injest = async (event, context, callback) => {
    await publishMessagesInBatches(JSON.parse(event.body));

    callback(null, { statusCode: 200 });
};

/**
 * Given the input messages, publish messages to SQS in batches of 10
 */
const publishMessagesInBatches = async (allMessages) => {
    let limitedBatchedMessages = [];

    for(let i = 0; i < allMessages.length; i++) {
        limitedBatchedMessages.push(allMessages[i]);

        if(i % 10 === 0) {
            await publishToSQS(limitedBatchedMessages);
            limitedBatchedMessages = [];
        }
    }

    if(limitedBatchedMessages.length > 0) {
        await publishToSQS(limitedBatchedMessages);
    }
}

/**
 * Publishes messages to SQS. Max 10 Batched images.
 */
const publishToSQS = async (messages) => {
    const params = {
        Entries: messages.map((m, index) => { return {
            Id: index.toString(),
            MessageBody: JSON.stringify({
                'site-url': m['site-url'],
                'image-url': m['image-url'],
            }),
            DelaySeconds: '1',
        }}),
        QueueUrl: process.env.QUEUE_URL
    };

    try {
        return new Promise(function(resolve, reject) {
            sqs.sendMessageBatch(params, function(err, data) {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    } catch(err) {
        console.log(err, err.stack);
    }
}