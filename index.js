'use strict';

const fetch = require('node-fetch');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const rekognition = new AWS.Rekognition();
const s3 = new AWS.S3();

exports.injest = async (event, context) => {
    for(const obj of JSON.parse(event.body)) {
        await processImage(obj, context.awsRequestId);
    }; 

    return { statusCode: 200 };
};

const processImage = async (obj, requestId) => {
    const imageUrl = obj['image-url'];
    const siteUrl = obj['site-url'];
    const imageName = encodeURIComponent(siteUrl + imageUrl);

    return 
        downloadImage(imageUrl)
        .then((bufferedImage) => uploadToS3(bufferedImage, imageName))
        .then(() => indexFace(imageName));
};

const downloadImage = (imageUrl) => {
    console.log(`attempting to download image ${imageUrl}`);

    return fetch(imageUrl)
        .then((response) => {
            if (response.ok) {
                return response.buffer;
            }
            return Promise.reject(new Error(
                `Failed to download image ${response.url}: ${response.status} ${response.statusText}`));
        }, console.log(error));
}

const uploadToS3 = (bufferedImage, imageName) => {
    return s3.putObject({
        Bucket: process.env.BUCKET,
        Key: imageName,
        Body: bufferedImage
     }).promise()
}

const indexFace = (imageName) => {
    console.log('attempting to index face');

    var params = {
        CollectionId: 'faces',
        Image: {
            S3Object: {
            Bucket: process.env.BUCKET,
            Name: imageName
            }
        }
    };

    rekognition.indexFaces(params, (err, data) => {
        if (err) {
            console.log(err, err.stack);
            return;
        }

        console.log(`indexed ${data.FaceRecords.length} faces in image.`);
        if (data.FaceRecords.length == 0) return;

        for (face of data.FaceRecords) {
            saveToDB(face.FaceId);
        }

        console.log('face indexed');
    });
}

const saveToDB = (faceId, s3ImageName, s3Bucket) => {

}
