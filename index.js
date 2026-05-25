const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

// parcel tracking API
const crypto = require("crypto");
function generateTrackingid() {
  const prefix = "PRCL"; //brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();

  return `${prefix}=${date}-${random}`;
}


const stripe = require('stripe')(process.env.STRIPE_SECRET);

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DBUSER}:${process.env.DBPASSWORD}@cluster0.0gdtq1d.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("zapshift_db");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection('payments');

    // parcel API
    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = parcelsCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    // for payment processing
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });
    // -------------------- //

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    })

    // payment related API
    // alternative API for payment processing
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {

            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: `Payment for ${paymentInfo.parcelName}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      res.send({ url: session.url });
    })

    // first 
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              }
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      res.send({ url: session.url });
    })

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log('session id is->', session)

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId }

      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return res.send({
          message: 'Payment already recorded',
          transactionId,
          trackingId: paymentExist.trackingId
        })
      }

      const trackingId = generateTrackingid();

      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) }

        const update = {
          $set: {
            paymentStatus: 'paid',
            createdAt: new Date(),
            trackingId: trackingId

          }
        }

        const result = await parcelsCollection.updateOne(query, update);

        const paymentRecord = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          paidAt: new Date(),
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          trackingId: trackingId
        }

        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollection.insertOne(paymentRecord)
          res.send({
            success: true,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            modifyResult: result,
            paymentInfo: resultPayment
          })
        }

      }
      res.send({ success: false })

    })

    // payment related API
    app.get('/payments', async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Zapshift working!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
