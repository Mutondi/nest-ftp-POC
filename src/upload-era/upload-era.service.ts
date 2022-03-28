import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Job } from 'bull';

import algoliasearch from 'algoliasearch';
const APP_ID = 'CQ4KI60B6S';
const ADMIN_KEY = '82ba2974759c46df91c86940391e28db';
const client = algoliasearch(APP_ID, ADMIN_KEY);

@Injectable()
@Processor('uploadRemittances')
export class UploadEraService {
  dbClient: SupabaseClient;
  constructor() {
    this.dbClient = this.createSupabaseInstance();
  }

  @Process('uploadRemittances')
  async uploadEraToDb(job: Job) {
    const eras: any[] = job.data.eras;
    if (eras.length > 0) {
      const processedEras = await this.formatEraData(eras);

      const erasToUpload = await this.getUploadableEras(processedEras);

      const { data, error } = await this.dbClient
        .from('remittances')
        .insert(erasToUpload);

      if (error) {
        throw new Error(error.message);
      }
    }
  }

  async getUploadableEras(eras) {
    const groupedErasByClaimsIndex = await this.groupBy(eras, 'claimsIndex');
    const differentClaimsIndexes = Object.keys(groupedErasByClaimsIndex);
    console.log('differentClaimsIndexes', differentClaimsIndexes);
    const searchClient = client.initIndex(eras[0].claimsIndex);
    const finaleEras: any[] = [];

    await Promise.all(
      eras.map(async (era) => {
        //get The lines of this era
        const lines: any[] = JSON.parse(JSON.stringify(era.formattedLines));

        //group the lines by serviceProviderRef

        const groupedByServiceProviderRef = await this.groupBy(
          lines,
          'serviceProviderRef',
        );

        //get all the keys (unique claims)
        const keys = Object.keys(groupedByServiceProviderRef);

        console.log('all unique serviceProviderRefs', keys);

        await Promise.all(
          keys.map(async (key) => {
            const lines: any[] = groupedByServiceProviderRef[key];
            const { hits } = await searchClient.search(key);
            let xeroId = '';
            if (hits.length > 0) {
              const claim: any = hits[0];

              xeroId =
                claim?.xero?.xeroInvoiceID ||
                claim?.rawXeroInvoice?.Reference ||
                '';
            }

            const totalPaid = lines.reduce((acc, line) => {
              return acc + line?.amountPad;
            }, 0);

            const sumOfClaimedAmounts = lines.reduce((acc, line) => {
              return acc + line?.amountClaimed;
            }, 0);

            finaleEras.push({
              ...era,
              processedOutput: {
                lines,
                xeroId,
                totalPaid,
                totalClaimed: sumOfClaimedAmounts,
                patient: lines[0].patient,
              },
            });
          }),
        );
      }),
    );

    return finaleEras;
  }

  async formatEraData(eras: any[]) {
    const res = await Promise.all(
      eras.map(async (era) => {
        const linesArray: string[][] = JSON.parse(era.stringifiedLines);

        const formattedLines = linesArray.map((line) => {
          return {
            patient:
              line[16] === '' && line[17] === ''
                ? line[13] + ' ' + line[14]
                : line[16] + ' ' + line[17],
            serviceDate: line[19],
            serviceProviderRef: line[9],
            line: line[20],
            claimedAmount: line[21],
            amountPaid: Number(line[23]),
            message: line[31] + ' ' + line[32],
          };
        });

        return { ...era, formattedLines };
      }),
    );
    return res;
  }

  //groupBy

  async groupBy(array: any[], key: string) {
    return array.reduce((result, currentValue) => {
      (result[currentValue[key]] = result[currentValue[key]] || []).push(
        currentValue,
      );
      return result;
    }, {});
  }
  createSupabaseInstance(): SupabaseClient {
    const supabaseUrl = 'https://rmvsbkfhlnqgkssjfcwm.supabase.co';
    const supabaseKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjM5NjY1NDcxLCJleHAiOjE5NTUyNDE0NzF9.xuH4vkPrDjFYXUKbwilA2AVGM_htulx25vGPDxh0QPQ';
    const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

    return supabase;
  }
}
