var Web3 = require("web3");
const path = require('path');
var fs = require('fs');

var Tx = require('ethereumjs-tx');
const config = require('./config.json');
const fetch = require('node-fetch');
const common = require('ethereumjs-common');
var cronJob = require('cron').CronJob;
var db = require('./db/db.js');
const mongoose = require('mongoose');
const transactionDetails = mongoose.model('transactionDetails');


const bscBridgeAbi = require("./abis/bscBridgeAbi.json");
const avaxBridgeAbi = require("./abis/avaxBridgeAbi.json");

const web3Bsc = new Web3(new Web3.providers.HttpProvider(config.BscConnectionURL));
const web3Avax = new Web3(new Web3.providers.HttpProvider(config.AvaxConnectionURL));

const BSC_CHAIN_ID = config.BscChainId
const GAS_LIMIT = "300000";


const AVAX_CROSS_SWAP_ADDRESS= config.AVAX_BridgeContractAddress;
const BSC_CROSS_SWAP_ADDRESS = config.BSC_BridgeContractAddress;

const OWNER_ADDRESS = config.adminAddress
let pKey


const AVAX_BRIDGE_INSTANCE = new web3Avax.eth.Contract(avaxBridgeAbi, AVAX_CROSS_SWAP_ADDRESS);
const BSC_BRIDGE_INSTANCE = new web3Bsc.eth.Contract(bscBridgeAbi, BSC_CROSS_SWAP_ADDRESS);

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
.then((data) => { pKey= data['privKey'];})
.catch((e) => console.log(e) );

var nonce = 0;
async function initNonce(){
    var _nonce = await web3Bsc.eth.getTransactionCount(OWNER_ADDRESS,"pending")
            nonce = _nonce;
            console.log("nonce",nonce);
        

}

var cronJ1 = new cronJob("*/1 * * * *", async function () {
  await initNonce()
  checkPending()
}, undefined, true, "GMT");


async function checkPending() {
  fs.readFile(path.resolve(__dirname, 'avaxBlock.json'), async (err, blockData) => {

      if (err) {
          console.log(err);
          return;
      }

      blockData = JSON.parse(blockData);
      let lastcheckBlock = blockData["lastblock"];
      let latest = await web3Avax.eth.getBlockNumber();
      latest = latest - 20
      console.log(lastcheckBlock,latest)
      blockData["lastblock"] = latest;

      AVAX_BRIDGE_INSTANCE.getPastEvents({},
          {
              fromBlock: lastcheckBlock,
              toBlock: latest // You can also specify 'latest'          
          })
          .then(async function (resp) {
              for (let i = 0; i < resp.length; i++) {
                  if (resp[i].event === "SwapRequest") {
                      console.log("SwapRequest emitted");
                      await decodeInputs(resp[i])
                  } 
                  
              }
          })
          .catch((err) => console.error(err));

      fs.writeFile(path.resolve(__dirname, './avaxBlock.json'), JSON.stringify(blockData), (err) => {
          if (err);
          console.log(err);
      });
  });
}




const getRawTransactionApp = function (_address, _nonce, _gasPrice, _gasLimit, _to, _value, _data) {
    return {

        nonce: web3Bsc.utils.toHex(_nonce),
        gasPrice: _gasPrice === null ? '0x098bca5a00' : web3Bsc.utils.toHex(_gasPrice),
        gasLimit: _gasLimit === null ? '0x96ed' : web3Bsc.utils.toHex(_gasLimit),
        to: _to,
        value: _value === null ? '0x00' : web3Bsc.utils.toHex(_value),
        data: _data === null ? '' : _data,
        chainId: BSC_CHAIN_ID
    }
}


async function decodeInputs(resp){
    
    console.log(resp.returnValues)
    const user = resp.returnValues.to;
    const amount = resp.returnValues.amount;
    const id = resp.returnValues.nonce;
    const toChainID = resp.returnValues.toChainID;
    const fromTransactionHash = resp.transactionHash


    if(toChainID == 56)
        await bscBridgeBack(user,amount,id,fromTransactionHash);
}


async function bscBridgeBack(user,amount,id,fromTransactionHash) {

    isAlreadyProcessed = await BSC_BRIDGE_INSTANCE.methods.getBridgeStatus("99999999999999999999999999999",43114).call();

    if(isAlreadyProcessed){
        console.log("Txn already processed")
        return
    }

    var encodeABI = BSC_BRIDGE_INSTANCE.methods.swapBack(user,amount,"99999999999999999999999999999",43114).encodeABI();

    let gasPrice = await web3Bsc.eth.getGasPrice();
    gasPrice = Math.floor(gasPrice*1.05)
    await initNonce()
    console.log("gasPrice",gasPrice)
    var rawData = await getRawTransactionApp(
        OWNER_ADDRESS,
        nonce,
        gasPrice,
        GAS_LIMIT,
        BSC_CROSS_SWAP_ADDRESS,
        null,
        encodeABI
    );
   
    var tx = new Tx(rawData);
    let privateKey = new Buffer.from(pKey, 'hex');
    

    tx.sign(privateKey);
    var serializedTx = tx.serialize();

    let params = { 
        fromChain : 'AVAX',
        fromTransactionHash : fromTransactionHash
    }
    
    var new_obj = {}

    web3Bsc.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'), async (error, hash)=> {
        if (error) {
            console.log("Tx Error : ", error);
            await bscBridgeBack(user,amount,id,fromTransactionHash);
        } else {
            console.log("Tx Success : ", hash)
            new_obj.toTimestamp = new Date().toISOString()
            new_obj.swapId = id
            new_obj.nonce = nonce
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

cronJ1.start();