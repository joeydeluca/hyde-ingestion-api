'use strict';

const AWS = require('aws-sdk');
AWS.config.update({region: 'us-east-1'});
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

exports.ingest = async (event, context, callback) => {
    await publishMessagesInBatches(JSON.parse(event.body), event.headers["client-id"]);

    callback(null, { statusCode: 200 });
};

/**
 * Given the input messages, publish messages to SQS in batches of 10
 */
const publishMessagesInBatches = async (allMessages, clientId) => {
    let limitedBatchedMessages = [];

    for(let i = 0; i < allMessages.length; i++) {
        limitedBatchedMessages.push(allMessages[i]);

        if(i % 10 === 0) {
            await publishToSQS(limitedBatchedMessages, clientId);
            limitedBatchedMessages = [];
        }
    }

    if(limitedBatchedMessages.length > 0) {
        await publishToSQS(limitedBatchedMessages, clientId);
    }
}

/**
 * Publishes messages to SQS. Max 10 Batched images.
 */
const publishToSQS = async (messages, clientId) => {
    const params = {
        Entries: messages.map((m, index) => { return {
            Id: index.toString(),
            MessageBody: JSON.stringify({
                'site-url': m['site-url'],
                'image-url': m['image-url'],
                'client-id': clientId,
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