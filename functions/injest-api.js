'use strict';

const fetch = require('node-fetch');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const rekognition = new AWS.Rekognition();
const s3 = new AWS.S3();
const mysql = require('serverless-mysql')({
    onError: (e) => { console.log('DB Error: ' + e) }
});
mysql.config({
    host     : process.env.DB_HOST, 
    user     : process.env.DB_USER,
    password : process.env.DB_PASSWORD,
    database : process.env.DB_NAME
});
const excludedWebsites = [
    'cdn'
];

exports.injest = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    for(const obj of JSON.parse(event.body)) {
        await processImage(obj, context.awsRequestId);
    }; 

    return { statusCode: 200 };
};

const processImage = async (obj, requestId) => {
    const imageUrl = obj['image-url'];
    const siteUrl = obj['site-url'];
    const imageName = encodeURIComponent(siteUrl + imageUrl);
    const s3Bucket = process.env.BUCKET;

    if(isWebsiteExcluded(siteUrl)) {
        return;
    }

    try {
        const bufferedImage = await downloadImage(imageUrl);
        const faceIds = await indexFaces(bufferedImage);
        if(!faceIds || faceIds.length == 0) return;

        await uploadToS3(bufferedImage, imageName, s3Bucket)
            .then(() => saveToDB(faceIds, imageUrl, siteUrl, imageName, s3Bucket));
    }
    catch(err) {
        console.log(err);
    }
};

const downloadImage = (imageUrl) => {
    console.log(`attempting to download image ${imageUrl}`);

    return fetch(imageUrl)
        .then(
            (response) => {
            if (response.ok) {
                return response.buffer();
            }
            return Promise.reject(new Error(
                `Failed to download image ${response.url}: ${response.status} ${response.statusText}`));
            }, 
            (error) => console.log(error)
        );
}

const uploadToS3 = (bufferedImage, imageName, s3Bucket) => {
    console.log("uploading to s3");
    return s3.putObject({
        Bucket: s3Bucket,
        Key: imageName,
        Body: bufferedImage
     }).promise();
}

const indexFaces = (bufferedImage) => {
    console.log('attempting to index all faces in image');

    var params = {
        CollectionId: 'faces',
        Image: {
            Bytes: bufferedImage
        }
    };

    return new Promise((resolve, reject) => {
        rekognition.indexFaces(params, async (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(new Error(err));
                return;
            }

            console.log(`indexed ${data.FaceRecords.length} faces in image`);

            resolve(data.FaceRecords.map(f => f.Face.FaceId));
        });
    });
}

const saveToDB = async (faceIds, sourceImageUrl, sourceSiteUrl, s3Name, s3Bucket) => {
    console.log(`saving ${faceIds.length} faces in db`);

    for (let faceId of faceIds) {
        try {
            await mysql.query({
                sql: 'INSERT INTO `faces` SET face_id = ?, source_image_url = ?, source_site_url = ?, s3_name = ?, s3_bucket = ?, created_date = CURRENT_TIMESTAMP()',
                values: [faceId, sourceImageUrl, sourceSiteUrl, s3Name, s3Bucket]
            });
        } catch(err) {
            if(!err.toString().includes('ER_DUP_ENTRY')) {
                throw err;
            }
        }
    }

    await mysql.end();
    console.log('db save complete');
}

const isWebsiteExcluded = (websiteUrl) => {
    for(let exludedString of excludedWebsites) {
        if(websiteUrl.indexOf(exludedString) >= 0) {
            return true;
        }
    }

    return false;
}
