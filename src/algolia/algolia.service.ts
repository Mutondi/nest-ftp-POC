import { HttpService, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

import algoliasearch from 'algoliasearch';
import { AppService } from 'src/app.service';
const fs = require('fs');
import * as admin from 'firebase-admin';

import axios from 'axios';
import path from 'path';
import { doc } from 'prettier';
const APP_ID = 'CQ4KI60B6S';
const ADMIN_KEY = '82ba2974759c46df91c86940391e28db';
const client = algoliasearch(APP_ID, ADMIN_KEY);

@Injectable()
export class AlgoliaService {
  constructor(private appService: AppService, private http: HttpService) {}

  async migratePatients() {
    const clients = await this.appService.getClients();

    const client = clients.filter((client) => client.pcns === '7229771')[0];

    const clientFirebase = this.createFirebaseInstance(client);

    console.log(clientFirebase.firestore().collection('Patients'));
    const allPatients = await clientFirebase
      .firestore()
      .collection('Patients')
      .orderBy('createdAt', 'asc')
      .get();

    console.log(allPatients);
    console.log(allPatients.docs.length);

    const patients = allPatients.docs.map((d) => {
      const patient = d.data();
      const firebaseId = d.id;

      const patientObj = {
        ...patient,
        id: uuidv4(),
        firebaseId,
        tenant: client.id,
        createdAt: this.convertSecondsToDate(patient.createdAt.seconds),
      };

      return patientObj;
    });

    //sort by createdAt (jsDate) from oldest to new
    const patientSortedByDate = patients.sort((a, b) => {
      return a.createdAt.getSeconds() - b.createdAt.getSeconds();
    });

    // add a fileNumber to each patient based on index + 1
    const patientsWithFileNumber = patientSortedByDate.map((patient, index) => {
      return {
        ...patient,
        fileNumber: client.patientFilePrefix + `${index + 1}`,
      };
    });

    const db = this.createSupabaseInstance();

    const { data, error } = await db
      .from('patients')
      .insert(patientsWithFileNumber);
    if (error) {
      console.log(error);
    }

    if (data) {
      console.log(data);
      return data;
    }
  }

  async getAllMissingClaims() {
    const clients = await this.appService.getClients();

    const customer = clients.filter((client) => client.pcns === '7229771')[0];
    let hits = [];
    const allClaims = await client.initIndex(customer?.claimsIndex).search('', {
      filters: 'creationTimestamp:1638309600 TO 1643580000',
      hitsPerPage: 1000,
    });

    console.info(hits.length);

    return allClaims.hits;
  }

  async moveClaimsMahlogo() {
    const clients = await this.appService.getClients();

    const customer = clients.filter((client) => client.pcns === '0655201')[0];

    const practiceId = customer.id;

    const db = this.createSupabaseInstance();

    const { data, error } = await db
      .from('claims')
      .select('*')
      .eq('tenantId', practiceId)
      .order('createdAt', { ascending: true });

    const formattedForAirtable = data.map((claim) => {
      return {
        Practice: 'DR WP MAHLOGO INC',
        Name: claim?.header?.patientName + ' ' + claim?.header?.patientSurname,
        Notes: claim?.responses[0]?.claimStatus,
        scheme: claim?.header?.medicalAid,
        link:
          'https://multitenantpma.web.app/patients/' +
          claim?.patientId +
          '/cases/' +
          claim?.caseId,
      };
    });

    const airtableObjs = await Promise.all(
      formattedForAirtable.slice(581).map(async (obj) => {
        const sheetObj = {
          records: [
            {
              fields: obj,
            },
          ],
        };

        const res = await this.http
          .post(
            'https://api.airtable.com/v0/appEBTNj7p9KM2nUb/Submitted%20Claims',
            sheetObj,
            {
              headers: {
                authorization: 'Bearer ' + 'keyJysZwwDBSIjqCb',
                'Content-Type': 'application/json',
              },
            },
          )
          .toPromise();

        console.log(res);
        return res.data;
      }),
    );

    return airtableObjs;
  }

  /**Moves patients to algolia */
  async movePatients() {
    const index = client.initIndex('mfuloanePatients');
    const db = this.createSupabaseInstance();

    const { data, error } = await db
      .from('patients')
      .select('*')
      .eq('tenant', 'a091d79a-79f9-4deb-9c2a-700bb81e73d0');

    if (error) {
      console.log(error);
    }

    if (data?.length > 0) {
      const dataToIndex = data.map((patient, index) => {
        return {
          objectID: patient.id,
          surname: patient.surname,
          fullNames: patient.fullNames,
          fileNumber: patient.fileNumber,
          medicalScheme: patient?.medicalAid?.medicalScheme || 'PVT',
          membershipNo: patient?.medicalAid?.membershipNo || 'PVT',
        };
      });

      //sort the data by fileNumber
      const sorted = dataToIndex.sort((a, b) => {
        return a.fileNumber - b.fileNumber;
      });

      return index.saveObjects(sorted);

      console.info(sorted);
    }
  }

  async moveCases() {
    const clients = await this.appService.getClients();

    const malf = clients.filter((client) => client.pcns === '7229771')[0];

    const malfFirebase = this.createFirebaseInstance(malf);
    console.info(malfFirebase);

    const allObservations = await malfFirebase
      .firestore()
      .collectionGroup('consultations')
      .get();

    console.log(allObservations.docs.length);

    const observations = [];

    await Promise.all(
      allObservations.docs.map(async (doc) => {
        const data = doc.data();
        const getDoctors = await malfFirebase
          .firestore()
          .collection('Patients')
          .doc(doc.ref.path.split('/')[1])
          .collection('consultations')
          .doc(doc.id)
          .collection('doctors')
          .get();
        console.log(getDoctors.docs.length);

        const doctors = getDoctors.docs.map((doc) => doc.data());
        const obj = {
          doctors,
          hospitalRecord: data?.hospitalRecord || {},
          type: data.type,
          status: data.status,
          createdAt: data.createdAt.toDate(),
          createdBy: data?.createdBy || '',
          firebaseId: doc.id,
          firebasePatient: doc.ref.path.split('/')[1],
          tenant: malf.id,
        };

        observations.push(obj);
      }),
    );
    console.info(observations, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db.from('cases').insert(observations);
    if (error) {
      console.log(error);
    }

    if (data) {
      console.log(data);
      return data;
    }
  }

  async moveSubjectives() {
    const clients = await this.appService.getClients();

    const malf = clients.filter((client) => client.pcns === '7229771')[0];

    const malfFirebase = this.createFirebaseInstance(malf);
    console.info(malfFirebase);

    const allObservations = await malfFirebase
      .firestore()
      .collectionGroup('O')
      .get();

    const allObservationsArray = allObservations.docs.map((doc) => {
      const data = doc.data();
      const { height, weight } = data;
      return {
        height: Number((Number(height) / 100).toFixed(2)),
        weight: Number(weight),
        bmi: Number((Number(weight) / (Number(height) / 100) ** 2).toFixed(2)),
        createdAt: data.createdAt.toDate(),
        createdBy: data.createdBy,
        firebaseDocumentId: doc.id,
        firebasePatientId: doc.ref.path.split('/')[1],
        firebaseConsultId: doc.ref.path.split('/')[3],
        tenantId: malf.id,
      };
    });
    console.info(allObservationsArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db.from('bmi').insert(allObservationsArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }
  /** Move BMI calcs over to supabase */
  /** 
  * async moveSubjectives() {
    const clients = await this.appService.getClients();

    const malf = clients.filter((client) => client.pcns === '7229771')[0];

    const malfFirebase = this.appService.createFirebaseInstance(malf);

    const allObservations = await malfFirebase
      .firestore()
      .collectionGroup('O')
      .get();

    const allObservationsArray = allObservations.docs.map((doc) => {
      const data = doc.data();
      const { height, weight } = data;
      return {
        height: Number((Number(height) / 100).toFixed(2)),
        weight: Number(weight),
        bmi: Number((Number(weight) / (Number(height) / 100) ** 2).toFixed(2)),
        createdAt: data.createdAt.toDate(),
        createdBy: data.createdBy,
        firebaseDocumentId: doc.id,
        firebasePatientId: doc.ref.path.split('/')[1],
        firebaseConsultId: doc.ref.path.split('/')[3],
        tenantId: malf.tenant,
      };
    });
    console.info(allObservationsArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db.from('bmi').insert(allObservationsArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }
  
  
  
  */
  async moveAssessments() {
    const clients = await this.appService.getClients();

    const malf = clients.filter((client) => client.pcns === '7229771')[0];

    const malfFirebase = this.createFirebaseInstance(malf);

    const allAssessments = await malfFirebase
      .firestore()
      .collectionGroup('A')
      .get();

    const allAssessmentsArray = allAssessments.docs.map((doc) => {
      const data = doc.data();
      return {
        createdAt: data.createdAt.toDate(),
        createdBy: data.createdBy,
        firebaseDocumentId: doc.id,
        firebasePatientId: doc.ref.path.split('/')[1],
        firebaseConsultId: doc.ref.path.split('/')[3],
        tenantId: malf.id,
        diagnosisCodes: data.diagnosisCodes,
      };
    });
    console.info(allAssessmentsArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db.from('icd').insert(allAssessmentsArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }

  /** Move Assessments (A)  over to supabase 
   * async moveAssessments() {
    const clients = await this.appService.getClients();

    const malf = clients.filter((client) => client.pcns === '0719870')[0];

    const malfFirebase = this.appService.createFirebaseInstance(malf);

    const allAssessments = await malfFirebase
      .firestore()
      .collectionGroup('A')
      .get();

    const allAssessmentsArray = allAssessments.docs.map((doc) => {
      const data = doc.data();
      return {
        createdAt: data.createdAt.toDate(),
        createdBy: data.createdBy,
        firebaseDocumentId: doc.id,
        firebasePatientId: doc.ref.path.split('/')[1],
        firebaseConsultId: doc.ref.path.split('/')[3],
        tenantId: malf.id,
        diagnosisCodes: data.diagnosisCodes,
      };
    });
    console.info(allAssessmentsArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db.from('icd').insert(allAssessmentsArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }
  */
  async moveEncounters() {
    const clients = await this.appService.getClients();

    const client = clients.filter((client) => client.pcns === '7229771')[0];

    const clientFirebase = this.createFirebaseInstance(client);

    console.log(clientFirebase);
    const allEncounters = await clientFirebase
      .firestore()
      .collectionGroup('Performed')
      .get();

    console.log(allEncounters.docs.length);

    const allEncountersArray = allEncounters.docs.map((doc) => {
      return {
        createdAt: doc.data().createdAt.toDate(),
        createdBy: doc.data().createdBy,
        firebaseDocumentId: doc.id,
        firebaseConsultId: doc.data().consultId,
        firebasePatientId: doc.data().patientId,
        tenantId: client.id,
        status: doc.data().status,
        eS: new Date(doc.data().eS),
        eE: new Date(doc.data().eE),
        pmb: doc.data().pmb === '' ? true : doc.data().pmb,
        billing: doc.data().billing,
        conditions: doc.data()?.conditions ? doc.data().conditions : null,
      };
    });

    console.info(allEncountersArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db
      .from('encounters')
      .insert(allEncountersArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }

  /** Move encounters (Performed) over to supabase 
   * 
   *   async moveEncounters() {
    const clients = await this.appService.getClients();

    const client = clients.filter((client) => client.pcns === '0655201')[0];

    const clientFirebase = this.appService.createFirebaseInstance(client);

    console.log(clientFirebase);
    const allEncounters = await clientFirebase
      .firestore()
      .collectionGroup('Performed')
      .get();

    console.log(allEncounters.docs.length);

    const allEncountersArray = allEncounters.docs.map((doc) => {
      return {
        createdAt: doc.data().createdAt.toDate(),
        createdBy: doc.data().createdBy,
        firebaseDocumentId: doc.id,
        firebaseConsultId: doc.data().consultId,
        firebasePatientId: doc.data().patientId,
        tenantId: client.id,
        status: doc.data().status,
        eS: new Date(doc.data().eS),
        eE: new Date(doc.data().eE),
        pmb: doc.data().pmb === '' ? true : doc.data().pmb,
        billing: doc.data().billing,
        conditions: doc.data()?.conditions ? doc.data().conditions : null,
      };
    });

    console.info(allEncountersArray, { structured: true });

    const db = this.createSupabaseInstance();

    const { data, error } = await db
      .from('encounters')
      .insert(allEncountersArray);
    if (error) {
      console.log(error);
    }

    if (data) {
      return data;
    }
  }
  */

  /** Move Claims over to supabase */

  async moveClaims() {
    const clients = await this.appService.getClients();

    const customer = clients.filter((client) => client.pcns === '7229771')[0];

    console.info(client, { structured: true });

    let hits = [];
    const allClaims = await client
      .initIndex(customer?.claimsIndex)
      .browseObjects({ batch: (objects) => (hits = hits.concat(objects)) });

    console.info(allClaims, { structured: true });
    console.info(hits.length);

    const portion = hits.map((documentData: any) => {
      if (
        documentData?.claimResponses &&
        documentData?.printedLines &&
        !documentData?.claimLines
      ) {
        const {
          authorised,
          userRef,
          transNum,
          diagCodes,
          invTimestamp,
          creationTimestamp,
          createdAt,
          options,
          deliveryType,
          respondingParty,
          swref,
          claimStatus,
          tranStatus,
          generalComments,
          rejections,
          failures,
          grandTotal,
          membershipNo,
          authCode,
          claimRequests,
          claimResponses,
          rawXeroInvoice,
          xeroInvoiceID,
        } = documentData;

        const printedLines: any[] = documentData.printedLines;
        const obj = {
          header: {
            ...documentData.header,
            grandTotal,
            membershipNo,
            authCode,
          },
          rawData: {
            claimRequests,
            claimResponses,
            rawDelayed: documentData?.rawDelayed || '',
          },
          xero: {
            rawXeroInvoice: rawXeroInvoice || '',
            xeroInvoiceID: xeroInvoiceID || '',
          },
          responses: [
            {
              type: 'Real-Time',
              authorised,
              deliveryType,
              respondingParty,
              swref,
              claimStatus,
              tranStatus,
              generalComments: JSON.stringify(generalComments) || '',
              rejections: JSON.stringify(rejections) || '',
              failures: JSON.stringify(failures) || '',
            },
          ],
          userRef,
          transNum,
          diagCodes,
          invTimestamp: invTimestamp || 0,
          creationTimestamp: creationTimestamp || 0,
          createdAt,
          options,
          reversal: documentData?.reversal || {},
          claimLines: printedLines.map((l) => {
            const { actualcode, shortdesc, uniqueid, price, total, qty, meta } =
              l;
            return {
              actualcode,
              shortdesc,
              uniqueid,
              price,
              total,
              qty,
              responses: [{ ...meta, type: 'Real-Time' }],
            };
          }),
        };

        if (documentData?.delayedResp) {
          const {
            authorisedpmt,
            generalComments,
            patientLiable,
            respDate,
            respResult,
            transNum,
            schemeLiable,
          } = documentData?.delayedResp;
          const delayedResp: any = {
            claimStatus: respResult,
            deliveryType: 'Medres',
            failures: '',
            date: respDate,
            generalComments: generalComments,
            rejections: '',
            respondingParty: 'Medical Scheme/Administrator',
            type: 'Delayed',
            authorised: authorisedpmt === 'NaN' ? '0.00' : authorisedpmt,
            patientLiable: patientLiable === 'NaN' ? '0.00' : patientLiable,
            schemeLiable: schemeLiable === 'NaN' ? '0.00' : schemeLiable,
            transNum,
          };

          obj.responses.push(delayedResp);

          const maxNumber = obj.claimLines.length;
          const latestResp = documentData?.rawDelayed; //response from switch

          const payload = latestResp['PushReplies.responsePayloadField'][0];
          //response payload

          const payloadArr: any[] = String(payload).split('\n');
          payloadArr.forEach((item, index) => {
            const temp = item;
            payloadArr[index] = temp.split('|');
          });

          for (let index = 0; index < maxNumber; index++) {
            /** for each line */
            const startingIndex = 0;
            const endingItem = payloadArr.find((item) => item[0] === 'Z');
            const endingIndex = payloadArr.indexOf(endingItem);

            const lineItemGroup = payloadArr.splice(
              startingIndex,
              endingIndex + 1,
            );

            const tRecord = lineItemGroup.filter((item) => item[0] === 'T');

            let lineResponse;
            let lineRespondingParty;
            let linedeliveryType;

            let lineschemeRef;

            let actualcode: any;
            let uniqueLineRef;
            if (tRecord.length > 0) {
              lineschemeRef = tRecord[0][6];
              uniqueLineRef = tRecord[0][5];
              const temp = tRecord[0][14];

              actualcode = tRecord[0][9];
              temp === '01'
                ? (lineResponse = 'Treatment Accepted For Delivery')
                : temp === '02'
                ? (lineResponse = 'Treatment Accepted For Processing')
                : temp === '03'
                ? (lineResponse = 'Treatment Rejected')
                : temp === '04'
                ? (lineResponse = 'Treatment Approved For Full-Payment')
                : temp === '05'
                ? (lineResponse = 'Treatment Accepted For Part-Payment')
                : temp === '06'
                ? (lineResponse = 'Treatment Reversal Accepted')
                : temp === '07'
                ? (lineResponse = 'Treatment Reversal Rejected')
                : (lineResponse = '');

              const respParty = tRecord[0][15];
              respParty === '01'
                ? (lineRespondingParty = 'Switch')
                : respParty === '02'
                ? (lineRespondingParty = 'Scheme/Administrator')
                : (lineRespondingParty = 'System');

              const delType = tRecord[0][16];
              delType === '01'
                ? (linedeliveryType = 'Real-Time')
                : delType === '02'
                ? (linedeliveryType = 'Batched')
                : delType === '03'
                ? (linedeliveryType = 'Queued')
                : delType === '04'
                ? (linedeliveryType = 'Rejected')
                : (linedeliveryType = 'System');
            }

            const rejections = lineItemGroup
              .filter((item) => item[0] === 'R')
              .toString();

            const comments = JSON.stringify(
              lineItemGroup.filter((item) => item[0] === 'G'),
            ).toString();

            let lineclaimedAmount;
            let lineauthorisedAmt;
            const lineZ = lineItemGroup.filter((item) => item[0] === 'Z');
            if (lineZ.length > 0) {
              lineclaimedAmount = (lineZ[0][10] / 100).toFixed(2);

              lineauthorisedAmt = (lineZ[0][18] / 100).toFixed(2);
            }

            //at line level

            /** FIND appropriate code in claimLines and update responses */
            const indexOfCode = obj.claimLines.indexOf(
              obj.claimLines.filter(
                (c) =>
                  Number(c.actualcode) === Number(actualcode) &&
                  c.uniqueid === uniqueLineRef,
              )[0],
            );

            if (indexOfCode !== -1) {
              const responses: any[] =
                obj.claimLines[indexOfCode]?.responses || [];

              responses.push({
                authCode: '',
                authorisedAmt: lineauthorisedAmt || '',
                claimedAmount: lineclaimedAmount || '',
                comments: comments,
                deliveryType: linedeliveryType || '',
                lineResp: lineResponse,
                rejections: rejections,
                respondingParty: lineRespondingParty || 'system',
                schemeRef: lineschemeRef,
                type: 'Delayed',
                date: respDate,
              });

              obj.claimLines[indexOfCode].responses = responses;
            }
            if (indexOfCode === -1) {
              const responses: any[] =
                obj.claimLines[indexOfCode]?.responses || [];

              const object = {
                authCode: '',
                authorisedAmt: lineauthorisedAmt || '',
                claimedAmount: lineclaimedAmount || '',
                comments: comments,
                deliveryType: linedeliveryType || '',
                lineResp: lineResponse,
                rejections: rejections,
                respondingParty: lineRespondingParty || 'system',
                schemeRef: lineschemeRef,
                type: 'Delayed',
                date: respDate,
              };
              responses.push(object);
            }
          }
        }

        return obj;
      }
    });

    const allClaimsArray = portion.map((doc) => {
      if (doc) {
        const data = doc;
        const header = data.header;

        const {
          patientId: firebasePatientId,
          consultId: firebaseConsultId,
          encounterId: firebaseEncounterId,
          medicalAid,
        } = header;

        //generate uuid and store in const id

        const id = uuidv4();

        const obj = {
          ...data,
          id,
          tenantId: customer.id,
          createdAt: this.convertSecondsToDate(data?.createdAt?._seconds),
          firebaseConsultId,
          firebaseEncounterId,
          firebasePatientId,
          patientId: null,
          caseId: null,
          encounterId: null,
          creationTimestamp: data?.creationTimestamp || data?.creationTimestamp,
          scheme: medicalAid || '',
          claimRef: data?.xero?.rawXeroInvoice?.Reference || '',
        };

        return obj;
      }
    });

    console.log('length=>', allClaimsArray.length);
    //make a post request using got

    const db = this.createSupabaseInstance();

    const obj = [allClaimsArray];

    //remove all null objects from allClaimsArray
    const filteredArray = allClaimsArray.filter(
      (item) => item !== null && item !== undefined,
    );

    //split filtered array into 5 arrays of 2000 objects or whatever is left over

    const splitArray = filteredArray.reduce((acc, curr, index) => {
      if (index % 1000 === 0) {
        acc.push([curr]);
      } else {
        acc[acc.length - 1].push(curr);
      }
      return acc;
    }, []);

    //post each array to supabase

    const res = await Promise.all(
      splitArray.map(async (arr, index) => {
        //const { data, error } = await db.from('claimss').insert(arr);
        // console.log(data?.length);
        console.log(`dmabaso${index + 1}.json`, arr.length);
        fs.writeFile(
          `dmabaso${index + 1}.json`,
          JSON.stringify(arr, null, 2),
          'utf-8',
          (err) => {
            if (err) throw err;
            console.log('Your index was successfully exported!');
          },
        );

        //  if (data) {
        //    return data;
        //  }
        //  if (error) {
        //    console.log(error);
        //    return error;
        // }
      }),
    );

    return res;
  }

  moveOneBatch() {
    fs.readFile('dmabaso3.json', 'utf-8', async (err, jsonString) => {
      const info = JSON.parse(jsonString);
      const db = this.createSupabaseInstance();

      console.info(info);
      const { data, error } = await db.from('claims').insert(info);

      console.log(data?.length);
      console.log(error);
      return data;
    });
  }
  //generateUUID

  //chunk array
  chunkArray(array, chunkSize) {
    const results = [];
    while (array.length) {
      results.push(array.splice(0, chunkSize));
    }
    return results;
  }

  //convert seconds to Date and return Date

  convertSecondsToDate(seconds) {
    const date = new Date(seconds * 1000);
    return date;
  }

  createSupabaseInstance(): SupabaseClient {
    const supabaseUrl = 'https://rmvsbkfhlnqgkssjfcwm.supabase.co';

    const SERVICE_KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjM5NjY1NDcxLCJleHAiOjE5NTUyNDE0NzF9.xuH4vkPrDjFYXUKbwilA2AVGM_htulx25vGPDxh0QPQ';

    const supabase: SupabaseClient = createClient(supabaseUrl, SERVICE_KEY);

    return supabase;
  }

  createFirebaseInstance(tenant) {
    return admin.initializeApp(
      {
        credential: admin.credential.cert(
          JSON.parse(JSON.stringify(tenant.firestoreServiceAccount)),
        ),
      },
      'malefahlo',
    );
  }
}
