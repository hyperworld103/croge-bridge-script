var Web3 = require("web3");

var fs = require('fs');
const path = require('path');
var Tx = require('ethereumjs-tx');
const config = require('./config.json');
const fetch = require('node-fetch');
const common = require('ethereumjs-common');
var db = require('./db/db.js');
const mongoose = require('mongoose');
const transactionDetails = mongoose.model('transactionDetails');



const bscBridgeAbi = require("./abis/bscBridgeAbi.json");
const ethBridgeAbi = require("./abis/ethBridgeAbi.json");

// const CHAIN_ID = 3;
const ETH_CHAIN_ID = config.EthChainId
const BSC_CHAIN_ID = config.BscChainId
const GAS_LIMIT = "300000";

const OWNER_ADDRESS = config.adminAddress
let pKey

const ETH_CROSS_SWAP_ADDRESS= config.ETH_BridgeContractAddress;
const BSC_CROSS_SWAP_ADDRESS = config.BSC_BridgeContractAddress;

const web3Bsc = new Web3(new Web3.providers.HttpProvider(config.BscConnectionURL));
const web3Eth = new Web3(new Web3.providers.HttpProvider(config.EthConnectionURL));

const BSC_BRIDGE_INSTANCE = new web3Bsc.eth.Contract(bscBridgeAbi, BSC_CROSS_SWAP_ADDRESS);
const ETH_BRIDGE_INSTANCE = new web3Eth.eth.Contract(ethBridgeAbi, ETH_CROSS_SWAP_ADDRESS);
var cronJob = require('cron').CronJob;

async function getPKey() {
    let myPromise = new Promise(async function(myResolve, myReject) {
        var AWS = require('aws-sdk'),
        region = "us-east-2",
        secretName = 'catoshiBridge',
        secret,
        decodedBinarySecret;
        // Create a Secrets Manager client
        AWS.config.loadFromPath('./config1.json');
        var client = new AWS.SecretsManager({
            region: region
        });

        await client.getSecretValue({SecretId: secretName}, async function(err, data) {
            if (err) {
                console.log(err);
                if (err.code === 'DecryptionFailureException')
                    // Secrets Manager can't decrypt the protected secret text using the provided KMS key.
                    // Deal with the exception here, and/or rethrow at your discretion.
                    throw err;
                else if (err.code === 'InternalServiceErrorException')
                    // An error occurred on the server side.
                    // Deal with the exception here, and/or rethrow at your discretion.
                    throw err;
                else if (err.code === 'InvalidParameterException')
                    // You provided an invalid value for a parameter.
                    // Deal with the exception here, and/or rethrow at your discretion.
                    throw err;
                else if (err.code === 'InvalidRequestException')
                    // You provided a parameter value that is not valid for the current state of the resource.
                    // Deal with the exception here, and/or rethrow at your discretion.
                    throw err;
                else if (err.code === 'ResourceNotFoundException')
                    // We can't find the resource that you asked for.
                    // Deal with the exception here, and/or rethrow at your discretion.
                    throw err;

                    myResolve(pKey);
            }
            else {
                // Decrypts secret using the associated KMS CMK.
                // Depending on whether the secret is a string or binary, one of these fields will be populated.
                if ('SecretString' in data) {
                    secret = data.SecretString;
                    // pKey=JSON.parse(secret).pkey;
                    myResolve(JSON.parse(secret));
                } else {
                    let buff = new Buffer(data.SecretBinary, 'base64');
                    decodedBinarySecret = buff.toString('ascii');
                    myResolve(pKey);
                }
            }
        });
    });
    return myPromise;
}

getPKey()
.then((data) => { pKey= data['privKey']; })
.catch((e) => console.log(e) );

 
var cronJ1 = new cronJob("*/1 * * * *", async function () {
    checkPending()
}, undefined, true, "GMT");


async function checkPending() {
    fs.readFile(path.resolve(__dirname, 'updateBlock.json'), async (err, blockData) => {

        if (err) {
            console.log(err);
            return;
        }

        blockData = JSON.parse(blockData);
        let lastcheckBlock = blockData["lastblock"];
        let latest = await web3Bsc.eth.getBlockNumber();
        latest = latest- 600 // running at a delay of 30 min to pick up txn which r not yet succesfull 
        console.log(lastcheckBlock,latest)
        blockData["lastblock"] = latest;

        BSC_BRIDGE_INSTANCE.getPastEvents({},
            {
                fromBlock: lastcheckBlock,
                toBlock: latest // You can also specify 'latest'          
            })
            .then(async function (resp) {
                for (let i = 0; i < resp.length; i++) {
                    if (resp[i].event === "SwapRequest") {
                        console.log("SwapRequest emitted");
                        await SwapRequest(resp[i])
                    } 
                    
                }
            })
            .catch((err) => console.error(err));

        fs.writeFile(path.resolve(__dirname, './updateBlock.json'), JSON.stringify(blockData), (err) => {
            if (err);
            console.log(err);
        });
    });
}



async function SwapRequest(resp){
    console.log(resp.returnValues);

    const user = resp.returnValues.to;
    const amount = resp.returnValues.amount;
    const id = resp.returnValues.nonce;
    const toChainID = resp.returnValues.toChainID;
    const fromTransactionHash = resp.transactionHash
    

    if(toChainID == 1)
        await ethBridgeBack(user,amount,id,fromTransactionHash);



}

async function ethBridgeBack(user,amount,id,fromTransactionHash) {

    isAlreadyProcessed = await ETH_BRIDGE_INSTANCE.methods.getBridgeStatus(id,56).call();

    if(isAlreadyProcessed){
        console.log("Txn already processed")
        return
    }

    let mongoData = await transactionDetails.findOne({ fromChain : 'BSC', fromTransactionHash: fromTransactionHash })
    if (mongoData.length <= 0) {
        console.log("no transaction found in db")
        return
    }

    let gasPrice = await web3Eth.eth.getGasPrice();

    rawData = mongoData.rawData;
    rawData.gasPrice = web3Eth.utils.toHex(Math.floor(gasPrice * 1.4));
 

    var tx = new Tx(rawData);
    let privateKey = new Buffer.from(pKey, 'hex');

    tx.sign(privateKey);
    var serializedTx = tx.serialize();

    let params = { 
        fromChain : 'BSC',
        fromTransactionHash : fromTransactionHash
    }
    
    var new_obj = {}
    web3Eth.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), function (error, hash) {
        if (error) {
            console.log("Tx Error : ", error);
        } else {
            console.log("Tx Success : ", hash)
            new_obj.toTimestamp = new Date().toISOString()
            new_obj.toTransactionHash = hash

            transactionDetails.updateOne(params, {$set: new_obj}, function(err, result) {
                if (err) {
                    console.log('DB update error', err);
                } else {
                    console.log('DB updated successfully');
                }
            });
        }
    })

}


cronJ1.start();
