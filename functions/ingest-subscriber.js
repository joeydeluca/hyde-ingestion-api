'use strict';

const fileType = require('file-type');
const url = require('url');
const fetch = require('node-fetch');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const sqs = new AWS.SQS({apiVersion: '2012-11-05'});
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
const maxFileSizeInBytes = 5242880; // 5MB

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    for(const obj of event.Records) {
        await processImage(JSON.parse(obj.body), context.awsRequestId);
    }; 

    return { statusCode: 200 };
};

const processImage = async (obj, requestId) => {
    const imageUrl = obj['image-url'];
    const siteUrl = obj['site-url'];
    const imageName = encodeURIComponent(siteUrl + imageUrl);
    const s3Bucket = process.env.BUCKET;

    let parsedSiteUrl = url.parse(siteUrl);
    if (parsedSiteUrl.hostname == null) {
        console.log(`Bad format for site-url: ${siteUrl}`);
        return;
    }

    if (
        isWebsiteExcluded(siteUrl) ||
        await doesImageUrlAndSiteUrlExistInDB(imageUrl, parsedSiteUrl.protocol + '//' + parsedSiteUrl.hostname)) {
        return;
    }

    let bufferedImage;
    try {
        bufferedImage = await downloadImage(imageUrl);
        if (!isFileTypeSupported(bufferedImage)) {
            return;
        }
    } catch(e) {
        console.log(e);
        return;
    }

    if (!isFileTypeSupported(bufferedImage)) {
        return;
    }

    if (await doesImageContainFace(imageUrl) === false) {
        return;
    }

    try {
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

    return fetch(imageUrl, { size: maxFileSizeInBytes })
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

const doesImageUrlAndSiteUrlExistInDB = async (imageUrl, siteHostname) => {
    try {
        const result = await mysql.query({
            sql: 'SELECT COUNT(*) AS count from faces where source_image_url = ? AND source_site_url like ?',
            values: [imageUrl, siteHostname + '%']
        });
        if(result.length === 1 && result[0].count > 0) {
            console.log(`image/site pair already exist in db image=${imageUrl} site=${siteHostname}`);
            return true;
        }
        return false;
    } catch(err) {
        console.log(err);
        return false;
    }
}

const doesImageContainFace = async (imageUrl) => {
    console.log('Checking if image contains a face');
    return fetch(process.env.DETECT_FACES_URL + encodeURIComponent(imageUrl))
        .then(async (response) => {
            if (response.ok) {
                const count = await response.text();
                return count != 0;
            }
            console.log('Unable to invoke detect faces api: ' + JSON.stringify(response));
            return false;
            }, 
            (error) => {console.log(error); return false;}
        )
        .catch(e => {
            console.log(e); return false;
        });
}

const isFileTypeSupported = (buffer) => {
    const type = fileType(buffer);

    if (type == undefined) {
        console.log('Unable to determine file type.')
        return false;
    }

    if (type.mime === 'image/jpg' || 
        type.mime === 'image/jpeg' ||
        type.mime === 'image/png') {
        return true;
    }

    console.log(`Unsupported file type: ${type.mime}`);
    return false;
}
