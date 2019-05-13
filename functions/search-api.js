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

exports.search = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    const profiles = await
        downloadImage(JSON.parse(event.body)['image-url'])
        .then(findFaceIds)
        .then(findProfiles);

    if (profiles === undefined || profiles.length == 0) {
        return { statusCode: 404 };
    }

    return { body: profiles, statusCode: 200 };
};

const downloadImage = async (imageUrl) => {
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

const findFaceIds = (bufferedImage) => {
    console.log('attempting to search for matching face id');

    var params = {
        CollectionId: "faces", 
        FaceMatchThreshold: 95, 
        Image: {
            Bytes: bufferedImage
        }, 
        MaxFaces: 100
    }; 
    
    return new Promise(function(resolve, reject) {
        rekognition.searchFacesByImage(params, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                reject(new Error(
                    `Failed to search for face id ${err}: ${err.stack}`));
                return;
            }

            if(data.FaceMatches.length == 0) {
                console.log("no face id found");
                reject(new Error());
                return;
            }

            resolve(data.FaceMatches.map(f => f.Face.FaceId));
        });
    });
}

const findProfiles = async (faceIds) => {
    console.log(`searching db profiles for ${faceIds.length} faceIds`);

    const profiles = await mysql.query({
        sql: 'SELECT * FROM faces WHERE face_id in ?',
        values: [[faceIds]]
    });

    await mysql.end();

    return JSON.stringify(profiles.map(({source_image_url, source_site_url}) => ({'image-url': source_image_url, 'site-url':source_site_url})));
}