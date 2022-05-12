const mongoose = require('mongoose');
var transactionDetails = new mongoose.Schema({
    fromChain: {
        type: String,
        required: 'Kindly specify source network.'
    },
    fromTransactionHash: {
        type: String,
        required: 'From chain Transaction Hash is required.'
    },
    fromTransactionStatus: {
        type: Boolean,
        required: 'From chain Transaction Status is required.'
    },
    walletAddress: {
        type: String,
        required: 'User wallet address not specified.'
    },
    swapAmount: { type: String },
    swapId: { type: Number },
    fromTimestamp: { type: String },
    fromBlockNumber: { type: Number },
    toChain: { 
        type: String,
        required: 'Kindly specify destination network.'
    },
    toTransactionHash: { type: String },
    toTransactionStatus: { type: Boolean },
    toTimestamp: { type: String },
    nonce: { type: Number },
    rawData: { type: Object }
});


mongoose.model('transactionDetails', transactionDetails);