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
const ftmBridgeAbi = require("./abis/ftmBridgeAbi.json");
const avaxBridgeAbi = require("./abis/avaxBridgeAbi.json");

// const CHAIN_ID = 3;
const FTM_CHAIN_ID = config.FtmChainId
const ETH_CHAIN_ID = config.EthChainId
const BSC_CHAIN_ID = config.BscChainId
const AVAX_CHAIN_ID = config.AvaxChainId
const GAS_LIMIT = "300000";

const OWNER_ADDRESS = config.adminAddress
let pKey

const ETH_CROSS_SWAP_ADDRESS= config.ETH_BridgeContractAddress;
const BSC_CROSS_SWAP_ADDRESS = config.BSC_BridgeContractAddress;
const FTM_CROSS_SWAP_ADDRESS = config.FTM_BridgeContractAddress;
const AVAX_CROSS_SWAP_ADDRESS = config.AVAX_BridgeContractAddress;

const web3Bsc = new Web3(new Web3.providers.HttpProvider(config.BscConnectionURL));
const web3Eth = new Web3(new Web3.providers.HttpProvider(config.EthConnectionURL));
const web3Ftm = new Web3(new Web3.providers.HttpProvider(config.FtmConnectionURL));
const web3Avax = new Web3(new Web3.providers.HttpProvider(config.AvaxConnectionURL));


const BSC_BRIDGE_INSTANCE = new web3Bsc.eth.Contract(bscBridgeAbi, BSC_CROSS_SWAP_ADDRESS);
const ETH_BRIDGE_INSTANCE = new web3Eth.eth.Contract(ethBridgeAbi, ETH_CROSS_SWAP_ADDRESS);
const FTM_BRIDGE_INSTANCE = new web3Ftm.eth.Contract(ftmBridgeAbi, FTM_CROSS_SWAP_ADDRESS);
const AVAX_BRIDGE_INSTANCE = new web3Avax.eth.Contract(avaxBridgeAbi, AVAX_CROSS_SWAP_ADDRESS);

var cronJob = require('cron').CronJob;

async function getPKey() {
    let myPromise = new Promise(async function(myResolve, myReject) {
        var AWS = require('aws-sdk'),
        region = "eu-west-2",
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
.then(async (data) => { pKey= data['privKey']; })
.catch((e) => console.log(e) );

var ethNonce = 0;
async function initEthNonce(){
    var _nonce = await web3Eth.eth.getTransactionCount(OWNER_ADDRESS,"pending")
        if(_nonce > ethNonce){
            ethNonce = _nonce;
            console.log("ethNonce",ethNonce);
        }
   
}

var ftmNonce = 0;
async function initFtmNonce(){
    var _nonce = await web3Ftm.eth.getTransactionCount(OWNER_ADDRESS,"pending")
        if(_nonce > ftmNonce){
            ftmNonce = _nonce;
            console.log("ftmNonce",ftmNonce);
        }
   
}

var avaxNonce = 0;
async function initAvaxNonce(){
    var _nonce = await web3Avax.eth.getTransactionCount(OWNER_ADDRESS,"pending")
    if(_nonce > avaxNonce) {
            avaxNonce = _nonce;
            console.log("avaxNonce",avaxNonce);
    }
   
}

 
var cronJ1 = new cronJob("*/1 * * * *", async function () {
    checkPending()
}, undefined, true, "GMT");


async function checkPending() {
    fs.readFile(path.resolve(__dirname, 'bscBlock.json'), async (err, blockData) => {

        if (err) {
            console.log(err);
            return;
        }

        blockData = JSON.parse(blockData);
        let lastcheckBlock = blockData["lastblock"];
        let latest = await web3Bsc.eth.getBlockNumber();
        latest = latest - 30  // delaying on dest chain so txn is permanent on src chain and updated on db
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

        fs.writeFile(path.resolve(__dirname, './bscBlock.json'), JSON.stringify(blockData), (err) => {
            if (err);
            console.log(err);
        });
    });
}



const getRawTransactionApp = function (_address, _nonce, _gasPrice, _gasLimit, _to, _value,_chainID, _data) {
    return {

        nonce: web3Eth.utils.toHex(_nonce),
        gasPrice: _gasPrice === null ? '0x098bca5a00' : web3Eth.utils.toHex(_gasPrice),
        gasLimit: _gasLimit === null ? '0x96ed' : web3Eth.utils.toHex(_gasLimit),
        to: _to,
        value: _value === null ? '0x00' : web3Eth.utils.toHex(_value),
        data: _data === null ? '' : _data,
        chainId: _chainID
    }
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

    else if(toChainID == 250)
        await ftmBridgeBack(user,amount,id,fromTransactionHash);

    else if(toChainID == 43114)
        await avaxBridgeBack(user,amount,id,fromTransactionHash);

}

async function ethBridgeBack(user,amount,id,fromTransactionHash) {

    isAlreadyProcessed = await ETH_BRIDGE_INSTANCE.methods.getBridgeStatus(id,56).call();

    if(isAlreadyProcessed){
        console.log("Txn already processed")
        return
    }

    var encodeABI = ETH_BRIDGE_INSTANCE.methods.swapBack(user,amount,id,56).encodeABI();
    console.log("Bridging to ETH");
    

    await initEthNonce();
    
    let gasPrice = await web3Eth.eth.getGasPrice();
    gasPrice = Math.floor(gasPrice*1.2)  
    console.log("gasPrice",gasPrice)

    var rawData = await getRawTransactionApp(
        OWNER_ADDRESS,
        ethNonce,
        gasPrice,
        GAS_LIMIT,
        ETH_CROSS_SWAP_ADDRESS,
        null,
        ETH_CHAIN_ID,
        encodeABI
    );
 


    var tx = new Tx(rawData);
    let privateKey = new Buffer.from(pKey, 'hex');

    tx.sign(privateKey);
    var serializedTx = tx.serialize();

    let params = { 
        fromChain : 'BSC',
        fromTransactionHash : fromTransactionHash
    }
    
    var new_obj = {}
    web3Eth.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async (error, hash)=> {
        if (error) {
            console.log("Tx Error : ", error);
            await ethBridgeBack(user,amount,id,fromTransactionHash);
        } else {
            console.log("Tx Success : ", hash)
            new_obj.toTimestamp = new Date().toISOString()
            new_obj.swapId = id
            new_obj.nonce = ethNonce
            new_obj.rawData = rawData
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

async function ftmBridgeBack(user,amount,id,fromTransactionHash) {

    isAlreadyProcessed = await FTM_BRIDGE_INSTANCE.methods.getBridgeStatus(id,56).call();

    if(isAlreadyProcessed){
        console.log("Txn already processed")
        return
    }
    
    var encodeABI = FTM_BRIDGE_INSTANCE.methods.swapBack(user,amount,id,56).encodeABI();
    console.log("Bridging to FTM");

    const gasPrice = await web3Ftm.eth.getGasPrice();
    console.log("gasPricr",gasPrice)
    

    await initFtmNonce();

    var rawData = await getRawTransactionApp(
        OWNER_ADDRESS,
        ftmNonce,
        gasPrice,
        GAS_LIMIT,
        FTM_CROSS_SWAP_ADDRESS,
        null,
        FTM_CHAIN_ID,
        encodeABI
    );
 

    var tx = new Tx(rawData);
    let privateKey = new Buffer.from(pKey, 'hex');

    tx.sign(privateKey);
    var serializedTx = tx.serialize();

    let params = { 
        fromChain : 'BSC',
        fromTransactionHash : fromTransactionHash
    }
    
    var new_obj = {}

    web3Ftm.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async (error, hash)=> {
        if (error) {
            console.log("Tx Error : ", error);
            await ftmBridgeBack(user,amount,id,fromTransactionHash);
        } else {
            console.log("Tx Success : ", hash)
            new_obj.toTimestamp = new Date().toISOString()
            new_obj.swapId = id
            new_obj.nonce = ftmNonce
            new_obj.rawData = rawData
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

async function avaxBridgeBack(user,amount,id,fromTransactionHash) {

    isAlreadyProcessed = await AVAX_BRIDGE_INSTANCE.methods.getBridgeStatus(id,56).call();
    if(isAlreadyProcessed){
        console.log("Txn already processed")
        return
    }
    var encodeABI = AVAX_BRIDGE_INSTANCE.methods.swapBack(user,amount,id,56).encodeABI();
    console.log("Bridging to AVAX");

    let gasPrice = await web3Avax.eth.getGasPrice();
    gasPrice = Math.floor(gasPrice*1.1)
    console.log("gasPrice",gasPrice)
    

    await initAvaxNonce();
    console.log("avaxNonce",avaxNonce);
    var rawData = await getRawTransactionApp(
        OWNER_ADDRESS,
        avaxNonce,
        gasPrice,
        GAS_LIMIT,
        AVAX_CROSS_SWAP_ADDRESS,
        null,
        AVAX_CHAIN_ID,
        encodeABI
    );

 


    var tx = new Tx(rawData);
    let privateKey = new Buffer.from(pKey, 'hex');

    tx.sign(privateKey);
    var serializedTx = tx.serialize();

    let params = { 
        fromChain : 'BSC',
        fromTransactionHash : fromTransactionHash
    }
    
    var new_obj = {}

    await web3Avax.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async (error, hash)=> {
        if (error) {
            console.log("Tx Error : ", error);
            await avaxBridgeBack(user,amount,id,fromTransactionHash);
        } else {
            console.log("Tx Success : ", hash)
            new_obj.toTimestamp = new Date().toISOString()
            new_obj.swapId = id
            new_obj.nonce = avaxNonce
            new_obj.rawData = rawData
            new_obj.toTransactionHash = hash
            avaxNonce = avaxNonce + 1

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
