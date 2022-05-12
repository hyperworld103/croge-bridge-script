const mongoose = require('mongoose');

    //CATOSHI db
    mongoose.connect('mongodb+srv://${admin}:${password}@cluster0.ptugc.mongodb.net/catoshiBridgeMainnet?retryWrites=true&w=majority',{useNewUrlParser: true, useUnifiedTopology: true}, (err) =>{
        if(!err){
            console.log('MongoDB connected successfully')
        }
        else{
            console.log('Error in connecting Mongodb', err);
        }
    })

require('./transactionDetails');