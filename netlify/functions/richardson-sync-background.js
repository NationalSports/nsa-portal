// Background function (15-min limit): syncs the Richardson Sports full stock
// catalog into the portal so the public Team Catalog (/adidas, /livelook)
// shows Richardson hats and headwear with images, sizes, and live per-DC
// inventory alongside the existing Adidas / UA / Nike / Agron feeds.
//
// Richardson's stock feed is a single JSON array (one row per SKU/size) from
// their report server. This function groups rows by style+color → one product
// per colorway, then writes:
//   products           — one row per style+color, id 'rich-{style}-{colorSlug}',
//                        brand 'Richardson', vendor_id = Richardson vendor (v5),
//                        category='Hats' for almost all styles, Level 4 pricing
//   richardson_inventory — per sku+size stock (Oregon DC + Texas DC), source
//                          'richardson'; next-avail date when qty=0
//
// Triggered by richardson-sync-cron (daily) or manually:
//   curl -X POST https://<site>/.netlify/functions/richardson-sync-background
//
// Env: RICHARDSON_FEED_URL (optional), RICHARDSON_FEED_USER (optional),
//      RICHARDSON_FEED_KEY (required), REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const DEFAULT_USER = 'CustFeed';
const DEFAULT_FEED_URL = 'https://reports.richardsonsports.com/reportserver/reportserver/httpauthexport?key=StockInventory&format=JSON&download=false';

// Level 4 wholesale pricing: style prefix → dealer price ($ each).
// Source: Richardson dealer price list, last updated 2026-04-21.
// Prefix matching — "PTS20" matches "PTS20M" and "PTS20S".
const LEVEL4_PRICES = {
  'PTS20': 7.44, 'PTS30': 8.08, 'PTS50': 8.50, 'PTS65': 9.14,
  'R15': 2.51, 'R18': 3.40, 'R20': 3.83, 'R22': 3.61,
  'R45': 3.83, 'R55': 3.83, 'R65': 3.40, 'R75': 3.61,
  '110': 6.66,
  '111': 5.87, '112': 5.66,
  '113': 5.66, '115': 5.66,
  '121': 5.22, '126': 8.27, '130': 5.00, '134': 6.74, '135': 6.74,
  '137': 3.92, '141': 8.27, '143': 7.61, '145': 6.09,
  '146': 4.57, '147': 5.22, '148': 7.18, '149': 5.22, '154': 10.44, '157': 8.27,
  '160': 7.61, '163': 7.61, '168': 6.31, '169': 8.27,
  '172': 8.05, '173': 8.05, '176': 7.83, '185': 7.18,
  '203': 6.09, '212': 5.00, '213': 5.66, '214': 4.79, '217': 6.09,
  '220': 6.53, '222': 6.74, '225': 6.53,
  '252': 6.09, '253': 8.27, '255': 5.87, '256': 7.83, '257': 6.74, '258': 6.31, '262': 6.09,
  '309': 6.53, '312': 5.87, '324': 5.44, '326': 5.44, '336': 6.74,
  '356': 5.66, '380': 7.40, '382': 6.53,
  '414': 6.96, '420': 8.05, '435': 9.35, '436': 6.96,
  '485': 8.48, '495': 7.61,
  '525': 7.83, '535': 7.40, '555': 6.96,
  '626': 8.48, '655': 8.27,
  '790': 10.87,
};
function getLevel4Price(style) {
  const s = String(style || '').toUpperCase();
  // Exact match first
  if (LEVEL4_PRICES[s] !== undefined) return LEVEL4_PRICES[s];
  // Prefix match: longest prefix wins
  let best = null, bestLen = 0;
  for (const [pfx, price] of Object.entries(LEVEL4_PRICES)) {
    if (s.startsWith(pfx) && pfx.length > bestLen) { best = price; bestLen = pfx.length; }
  }
  return best;
}

// Style → Google Drive file ID for blank cap images.
// Image URL: https://drive.google.com/uc?export=view&id={FILE_ID}
// Source: Drive folder 1GM5dqdSoTpvbqQismVxHV9L8LkIVLadm / BLANK CAP IMAGES
const DRIVE_IMAGES = {
  '110':     '1aNMwNWp1v25LM1e20iyrT7lyZedfVPSF',
  '111':     '1Ulvlo0f-BtfRzV6rGSTd5CYejXTpSiwY',
  '111P':    '1O5_TdPzD621b7PfNem67mhwsSTs-sU4O',
  '111PT':   '1QaMtv29bE8DgTxwE04DfNVAKfDBQmOwg',
  '111T':    '1uS6ORasmL3nDv_o7RFLwfrEq6D12n-Y0',
  '112':     '1c_1dlGltyjf7ZidHKd0HLHgs1Laok4nJ',
  '112+':    '13tuhCIkwnHQUn0FNn6pVyPQced9k_Hq5',
  '112FP':   '1MRNOx3bG2yMtb4XQB-qxGpuTYqK-9ou6',
  '112FPC':  '1KJSywoivO3WAXg8EP0Z9PmHAXNQuue8D',
  '112FPR':  '11RmHNfhkkj6Q_w2XGu4zi25pXSypnJZF',
  '112LN':   '1Nqd0ikjScTy0PxolLKYZ0Z_OtsQZCemp',
  '112P':    '1Eh7lu-nd8PzpELovMDj9sLzMmzNBnsuL',
  '112PFP':  '1PbfbB1Nf4MjPicBHJOnqfiWxfkzoR4Fz',
  '112PM':   '1XCcvc2GzaNopJoi_e0khHI9H-0TOhjdz',
  '112PT':   '1V-I-E0J_YABByKYwIUEyKeShU9lItwZD',
  '112RE':   '17awn0dc1u7dQkKdoBF1OcJTQ_L5NNT4Y',
  '112T':    '1bBGWYomn5frjvCacBQ-InaZ_fjEqfxht',
  '112WF':   '1Ezri-LlG_kSO2oNOQ4w6e1QoATfqXdSd',
  '112WH':   '1JjS0UG7prE4v-ouUIZRLDPg9J42fP0T6',
  '113':     '1dFkf0QrE8gQ-irmXI0h_SINZ0MCxpxcJ',
  '115':     '1P5ryXCP6kAoGakvl0iyopnY5KusEK8TV',
  '115CH':   '1rFoRxHX_3o18LtcDsFvTCAnYA7Tnl9uA',
  '120':     '1LP1nLB8OHtijcZ2NAMqoXtoxKd0GqoOd',
  '121':     '1lHqOEKXExcDEthJ_YdbBRd2m24L6yKov',
  '126':     '1kFby156xFRm5tj41w3AKflbIr6XiCbR3',
  '127':     '1uRu4MuXwr4hMm9qSS2LMXxrtSO3KuDTu',
  '130':     '11MQ-5WXBCTCiS2gKt3BR40009ndlG8Ui',
  '134':     '1M2Y602t0ZRgfJX_fLz_EJjFnG9ByozUT',
  '135':     '1EzOWUwnyi147Ds3O2x3um2wTRcaVRQjK',
  '137':     '1-M6N6ACNi45hQBzmQBfBjnoKYIhKqqv0',
  '138':     '1nGNya29_NKQMESEgYAZ_tccSgUttt2MR',
  '139RE':   '1wbsCok0qDDczD6_tnI80aYDsce0eQDZJ',
  '141':     '1gGk-42RKtdFZ1TE6KMsfLq5U3PMhX1SR',
  '143':     '16Puw7NZL0d9-alkE5I1Ebsl8LwjeSCrM',
  '145':     '1NWI1qT3ek7S2cfDHgcbk3HY1SyerTL1h',
  '146':     '1w6tVfRBgVCjUMvNqKhyxNqG6uFNijIBn',
  '147':     '1R-yZqqnr-V5R90l2qtVS1hCuWONUiA2-',
  '148':     '1qKO0VB6OD5z9iFrE1yRr0jhbFzfe9Es1',
  '149':     '1WEuFvHr2STyS2k943xyVlvzomgoPFSUw',
  '154':     '1DEHV5PMz0ytoGq2C0knCJXHuav-IfJLY',
  '155':     '15cMR6CLT3gRFpnoTN1mIk-RYF_BHHg5s',
  '157':     '1AuOLBkPIOlJyKWv8nze7jsgEXxBy9lt5',
  '159':     '1XG8dSHnJOh4g9ctf0ItDdPAFkjsbyRg_',
  '160':     '1xmJW-a4dStNgfpS4VosEBKI2DhwVo6f9',
  '163':     '1F2jPbTpdJMzjeEuOe6g4dWisCwRH-Z-o',
  '168':     '1TvA7P2dkMXDZ8Hfprq2xnf9KQnfEO5_t',
  '168P':    '1P2fWD0Q7kQrNNZ0Ws-ZpQOIiuGADITIn',
  '169':     '10YqaRcngHk8cvI_4FiOeB82ZX0mbnbeZ',
  '172':     '1DKRxxf1e73WDnlA2ZegForkwDc20jo2b',
  '173':     '1AMtbYa9wzXHzAvZtf0plJBc1bxLPimOm',
  '174':     '1jfc7w40qjecdASZHOjawup6JubIIDBdY',
  '176':     '1IZf1ZLgXrYb_1lFP4djC3aqHFI3HMK_T',
  '178':     '1ue15T19_1xUh-6B2rmuZpgSAspRt7jRm',
  '185':     '1iIMSo3GB5HAdhKtVCND3fh9li6t72F1-',
  '203':     '1UYIB4ndKOTbDXqB68Dg6LnfJopAV4Asg',
  '212':     '1__prW6txuG7zLmE2bBR8MN-2ljPUNCRL',
  '213':     '12uI97BLWVVxJ-LE77NNnhW0bQRzv93IM',
  '214':     '14-ZwXxCDgai2_5bVn6TTmb-oEYvayGkh',
  '217':     '1dUGQAXwkR18nsMqXq8f9m9eFIO9M8iIq',
  '220':     '1lLEUqrCKGhkGzxwzRFkrsZHbVwawBQG_',
  '222':     '1cwS0Zdgn6X9IcPnFsyHkD0UO-moHUxOQ',
  '224RE':   '1wrMj55-z6YxoqLPjGW6jxEERKlVWik0m',
  '225':     '16gKkM-X3MPvt5UaDG6xMmCR5ZqzeACNN',
  '226':     '1PeqqMcn_lkMW_-LTt_-gfGiPaZzHBhfl',
  '227':     '1nKLcmzKjPbitcVn8MrM-qTIvDlx9vtxo',
  '228':     '1m2TODJmKSUG09syfB7lMGnmZFcqG-SQO',
  '252':     '1RsVHkQ6KS2vXP1TgHs-Ff_JWVg3G2VuG',
  '252L':    '1f9lPmajWl_36VV2iU4epDzoKzLTbEtXj',
  '253':     '1Ll1mXHYt32dOCdZAkVQbgh-dailNWcNp',
  '254RE':   '1XeAnlg0E9SzE5AMBdQ889yytHJ5HRLv-',
  '255':     '16ghDxuEZuYE06kF8A6T53AiQXOvgNrsJ',
  '256':     '1GPgIpVL8EFKHX48yxsNsKbPvUXeGaz1j',
  '256P':    '1HLygu5FaOvnyGxJ439UkVHl2rh0C8dAU',
  '257':     '1houW6-eKtl8HDLRTxsbQXPhalMChY5jP',
  '258':     '1YyVq31SqOoxkOLFn8X3fEle_kfsfl6HY',
  '262':     '1NU-RllkckedJG-kli8Heg780iasGjCKr',
  '275':     '15P6xQYqd2lpDCVP_h2C2nBoAx6jy6GOp',
  '309':     '1lhIrMKcHGQ-l1JwsLJoQ4YW5zZEteLt5',
  '312':     '1AvL3a7J3gEzNzQPFDlF3riOxdmG0qYqI',
  '312P':    '1gfQ6D4uZgplX8D--q-wG1yM5dR1cobhR',
  '320':     '1cFMYZZ6KxLGPsy4GXEqsW4LACmU83J4l',
  '320T':    '1DFGYmAson-zMYpb_DyzclTgpjlOhv6dl',
  '321':     '1pK6MzOz8ojBt-OAxlw8DCmLdfWeOFur8',
  '322':     '1pnt-ChU8mzQ5cZZeF5tKLgpqRxOyZBze',
  '323FPC':  '1Ky5q22tK6EmoNcXl3zjQ4FAuKikxmven',
  '324':     '1hPMB06yePx2uhZlwquEDXN4BjolVjoCx',
  '324RE':   '1fEaOfAJKIasegWvgajPdosLWutOAA2y9',
  '325':     '1mGvH0d8m1vxt2GmeGl_sovu2WMPM7qJT',
  '326':     '1y9le2AHW3PW4rpFsV0ZM-hY9x90WfTf8',
  '336':     '1NRcQwIBBpL2cl96A1qmKl3D9JufFjRNy',
  '355':     '1fWmIPzEI-z4NH7MhRynoGE4JTTqx4lrQ',
  '356':     '18qdoBmbpDY20dF4Mv9uMbBlx6kZTBtC0',
  '380':     '10KPf7Cab6keyKm1PndXYm8rsIL1fAeXl',
  '382':     '1tSOp9FzmZpLYeRUKuLBSrC1YsrVz9bpU',
  '414':     '1xu_qmmOkWnCyvcZ5Acyjq5KcHhTjl-wb',
  '420':     '1CUlioJzF7W_FS0Ms5y00HPyEjAgtZ6hX',
  '435':     '12njfC3Fjb5B3RMfK-FJ2TqpXmwmuIc3u',
  '436':     '1Mf4fkbHiT4sBaWrb5O-aN-h8c0kRRqZg',
  '439':     '1az4rYMWQcOva4MghT5gF_CUtFBxm-lLo',
  '485':     '17pZ9VudiwMhrVNGfnQjuXeQTMiCwfxTV',
  '487':     '1FbZRWxoTAyeP9BiuX9uXjPm6J6Na2acA',
  '495':     '1wbxdVUre4U928uhRVDcHp_3CWQ2bLLsP',
  '510':     '1RXJ0rxnSwiegxgdukqMt_ouHa0Ct_9g6',
  '511':     '11pwFQbQVAR1vmr_XdUYP-pX0lywvcyt3',
  '512':     '1L3bASVtlCM4umHbso03cC39wiFwEEUUl',
  '514':     '1POrfCCCqOlpbeDthXVhrPMv-Q2cGYwgA',
  '520':     '1UhLg-loID7VB9FOhmM1M8xmSagg_220e',
  '525':     '13mJKl8_fFPxRdsLWln211aS5iE3pM1lk',
  '530':     '1ld0p6RwN9pbaoLei3HjzWH_k1shrWvzm',
  '533':     '1qkWjZSsq6ddwW9wOXDgGCX9fSmY_dV1u',
  '535':     '1ZeMqk_L8b2yF_P1RgnzqMS6Egot7f0YS',
  '540':     '1UUwRu2NnSpv3HiMlJpl3W11LoobB4qY-',
  '543':     '1gHYqt33I8g5whU-ULHuOK-CGs32GN75A',
  '545':     '1hcGdi_QBJYNu7wF2d4ACUhh4WotqwG2x',
  '550':     '1hyfzolDrmByndPHHeQ9SXtnZkxowWvXs',
  '585':     '1lmcM8Nbr4g8JlF4kIJrYtu8ogQfkJgB4',
  '632':     '1119AT4vzRs3Ut6Kbo0o7wvV_46xABvMW',
  '633':     '1eAVA3IC4VoZZnnK0UxdPmYhOw5HS-A5-',
  '634':     '1iIwavVsndLuQPxL_6W3MTpSwGbPeEOMn',
  '643':     '1Qljzsqn4J0U0yEBGNRjy0T-KwYMQTZsV',
  '653':     '1UWfgjEuXtL0YqreFJZD3cLaPuy1HXBYx',
  '675':     '1iAYU-a2NrMBQzURjupMk7nti2kA9qnKE',
  '707':     '1ddyVYtkr8dk0xmKL6b6klU-jOnselCJW',
  '709':     '1U-Zyhc2U5bYXcYy1PBOOJBY1I629d2ij',
  '712':     '1-IgaEOr-iwaYutEE-tt37opb5QHShQ2A',
  '715':     '1_3A_x988m5g8CG8mT42WiStqB71_38eE',
  '733':     '1ooQlVzFI0tmAHMcFvM6WyvSouLLWYmn0',
  '740':     '10c6_mPsniPRIRQEGi7eg1e8Fqq5KUamx',
  '743':     '1y0EaKp4AS-HNbx8EGKfWa3sSc1URIWHR',
  '753':     '17f-buHG6t4ek1HNzF6XlmE3HAr6QfNUx',
  '775':     '1XypIzI0oBSsMGakXyP3-UhYNLw_kC1G1',
  '810':     '1GOUny7c6zc4uxwjNU9VGN00szMWAhU-_',
  '822':     '15lSvqAuflMhoH3NuCyHPPVUY9_hrou6n',
  '824':     '169iKj8N5-HAwv6hR_gAdMIng6uVEOp_c',
  '827':     '1N4hPSB4pzxujgOuK8nBNS-E8dGu8cA1r',
  '828':     '1gHP1LN1oqtaWg7sC3Uvy2vIYAEcCpevd',
  '835':     '15R1QP8fOQZ_Oh8_KOOmv6DTZuhd-30eS',
  '840':     '1bS5UGE0zLQZKsp1-7s9UFlMMQEsmANyl',
  '843':     '1kGYJER3DSQADjay3QISFY4C1D97Q74iK',
  '844':     '1C2JdmkvG1j370BDIVgk4s-Tg0uoty_9N',
  '848':     '1kJaj3C8RI_WwUwNMUb3Cql6g1bkCHaWz',
  '855':     '1JHTlTrLehmpnovPKh4KzDBhmLN6dBeGk',
  '862':     '11XVpvfr6RJ9uhc2udZkbsy3mOJXd6vLZ',
  '863':     '1cbsY2nj1-mQBo5Yqxxz9avzGqrFsv4jo',
  '865':     '1qdkZ-HKMssZV_q8k8oPbhGHZUESwerKk',
  '870':     '17aK8ZUboNpJv78MtCG4VM9ML5NDGsBz4',
  '874':     '1bS8RKoQbepQ-bvCqxFcX4Cvr4Vj1BEk-',
  '880':     '1bbh_VrX6Rqf0A2g_cdylB8Q_ssH4WBmX',
  '882':     '1WXplTxTOA4SOnsfwjIQ4R-zU5vjMZB44',
  '882FP':   '1kbV8LkMpC1VUCu4uaUMQMsfpfhz5qCSK',
  '884':     '19UvDcMAlr-f95sV-p7Msez7C3GJj29Qw',
  '909':     '18NUjZC-gU90SHAesLjXfRmb4s6QuiP1r',
  '910':     '1XZtsJkkzVf_Q4U8yGLCjUzdBRajDPvDt',
  '930':     '1DdGlK6QmYhsEdVFnvOIhm-KkCimZHX6Q',
  '931':     '1XHNioEW58u31_c0oruYjv7tsYwNOZG7L',
  '932':     '1xcnUTKBVITZPe0Z1FV__yYJExCL8MnyV',
  '933':     '18Y9SrFLMvmOS-hJxuCTCBckIwI4T26ah',
  '934':     '1KgEoEQSLcdI2cZ2WYfz-OPO1FIlEUdYO',
  '935':     '1elW-Gc2sjsKFCNujOc2yRIxTJvQ2qhF3',
  '936':     '1j7aBARjbwGyoanmPPMAESSArtLR9MaMM',
  '937':     '1c-uZ9Vmxfj7FzBAo0Qz8TWp5Nh4e4yfX',
  '938':     '1btZvAdeSbEQaysyWlEyvhQpdgeINzW9Q',
  '939':     '1lXgHztoxPFgPln1Abl2Rny7Dz0IPtuxY',
  '942':     '14a9WArQd6GQ8_Y1xs7tqp7L_YzP5VWIx',
  '944':     '1hFkwU3RL_L-U4DSXc5dTe3Ywcqeq6sdL',
  'A7110LS': '1CUKu9RY7l9ze88BUsKkcwzrtUPsSySm9',
  'A7110SS': '1dqqOtr4ux9czCs3Fv5e1K7L8eOyNCyeh',
  'A7200SSH':'1eMhR_f9brnh55KlqMnC8AEWqYIQLL9eZ',
  'C12-CTM': '1eNJXX_IqPQLUPyoqNQJ9leWU3-TYlBFb',
  'C45-PERF':'1dFN-jTg0dcOBaVira-Xk6ejv-BVl9qbR',
  'C52-WM':  '11U4g7_JHi6qlJjeSMW_-ftrYCdLnQkCP',
  'C54-FM':  '1uTHt4hSnhkZxwKu4iaRqh_ZS45LNQWTm',
  'C55-CT':  '1R-bCozqZA9RHtVh9phjfWvkQNS88Y2o5',
  'C55-N':   '1w9aTEFg8CNbKqRxgkOfGIxlJaNPakQb_',
  'C58-CTM': '1rE9ME2FbdUdaoZmfLXDZoGLgPjF6MK3p',
  'PTS20':   '13QFlPvBhPI4Lwt2ltNoFklIZ19WtjTIa',
  'PTS20M':  '1Z7Q0mqxButHJyX6HdDlJ5pMNCKbYl0qN',
  'PTS30':   '1ujL4a9hN54x6nymdAAYDA8iyUGdWoLVQ',
  'PTS50':   '1hE8gxjmV4ARRenGapUf3PxHqpMoige-j',
  'PTS65':   '1vXE4OgQFuxdouQu7X5DrVMuF7tVbZYr8',
  'PTS75':   '1BklAJsadKyV0LO73W0iDg0aC5fNuB6ai',
  'R15':     '1QSL5vITgb7GoWGjzQNK7rstlzZxU5s76',
  'R18':     '1g3pZTG3y3zTyPOr44stKzNlIvsnj5_og',
  'R20':     '17Vct8mToqiOsA37KqTBn4fTxuNHbBlEJ',
  'R22':     '12XozZVRQoI4HJiRcnVt6qKOJAsPQ_QgK',
  'R45':     '1IpwGcV7Azh5mcDSdMs2_4Mp9Y0NsNeZS',
  'R55':     '1WCXmuCQ32q6WERm-bQs5BjkP0fa6VfqK',
  'R65':     '1jZJQKiuFm6KW4mgErcWHDPi2LSvw0R05',
  'R65S':    '1ypbq0sotGMYgC5Kw_lBKSUUHjKfRyEdD',
  'R75':     '1dM7IyCEEbdKlth8iA30QP0mP8IBTYV5D',
  'R75S':    '1Yo9vkgwhN-hOjRRQNBpNRil2_XZewslx',
  'R78':     '1Oa2BkAQKU9nh98IL7JNNXBRoyGdpGXhX',
};
// lh3.googleusercontent.com serves the file directly (200 image/jpeg). The older
// `uc?export=view` form 303-redirects to a download endpoint that browsers can't
// render in an <img>, so it shows "image coming soon". Format: BASE + id + SIZE.
const DRIVE_IMAGE_BASE = 'https://lh3.googleusercontent.com/d/';
const DRIVE_IMAGE_SIZE = '=w800';

const CATEGORY_RULES = [
  ['Beanies', /BEANIE|KNIT|TOQUE/i],
  ['Visors', /VISOR/i],
  ['Hats', /.*/],
];
function mapCategory(style, description) {
  const text = String(style || '') + ' ' + String(description || '');
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Hats';
}

// Two description formats exist in the Richardson feed:
//   Format 1 (hats):    "112 Solid Black MD-LG"  → strip style prefix, last token = size
//   Format 2 (apparel): "Rise Performance ... Black Size 2XL" → word before "Size" = color
function parseDescription(description, style) {
  if (!description) return { color: '', size: '' };
  let s = String(description).trim();
  // Format 2: "... [Color] Size [SizeValue]" — detect " Size " keyword near the end
  const sizeMatch = s.match(/\s+Size\s+(\S+)\s*$/i);
  if (sizeMatch) {
    const size = sizeMatch[1];
    const beforeSize = s.slice(0, sizeMatch.index).trim();
    const words = beforeSize.split(/\s+/);
    const color = words.pop() || '';
    return { color, size };
  }
  // Format 1: "[Style] [Color words...] [Size]"
  if (style) {
    const re = new RegExp('^' + String(style).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
    s = s.replace(re, '');
  }
  const parts = s.split(/\s+/);
  if (!parts.length) return { color: '', size: '' };
  const size = parts.pop();
  return { color: parts.join(' ').trim(), size };
}

// MM/DD/YYYY → YYYY-MM-DD (null if invalid/N/A)
function toISODate(str) {
  if (!str || /^(N\/A|PHASEOUT)$/i.test(str)) return null;
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

exports.handler = async () => {
  const feedKey = process.env.RICHARDSON_FEED_KEY;
  const sbUrl   = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!feedKey || !sbUrl || !sbKey) {
    console.error('[richardson-sync] missing config — need RICHARDSON_FEED_KEY, REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, body: 'Not configured' };
  }

  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });

  try {
    // 1. Richardson vendor id
    const vRes = await sb('vendors?api_provider=eq.richardson&select=id&limit=1');
    const vendors = await vRes.json();
    const vendorId = Array.isArray(vendors) && vendors[0] && vendors[0].id;
    if (!vendorId) return { statusCode: 200, body: 'No Richardson vendor configured (api_provider=richardson)' };

    // 2. Fetch Richardson stock feed
    const feedUser = process.env.RICHARDSON_FEED_USER || DEFAULT_USER;
    const feedUrl  = process.env.RICHARDSON_FEED_URL ||
      `${DEFAULT_FEED_URL}&user=${encodeURIComponent(feedUser)}&apikey=${encodeURIComponent(feedKey)}`;
    console.log('[richardson-sync] fetching stock feed…');
    const feedRes = await fetch(feedUrl, { headers: { Accept: 'application/json' }, redirect: 'follow' });
    if (!feedRes.ok) throw new Error('Richardson feed HTTP ' + feedRes.status);
    const feedText = await feedRes.text();
    console.log('[richardson-sync] feed text length:', feedText.length, 'starts with:', feedText.trimStart().slice(0, 30));
    if (feedText.trimStart().startsWith('<')) throw new Error('Richardson feed returned HTML — check RICHARDSON_FEED_KEY');
    const rawRows = JSON.parse(feedText);
    if (!Array.isArray(rawRows)) throw new Error('Richardson feed expected array, got: ' + typeof rawRows + ' keys=' + (rawRows && typeof rawRows === 'object' ? Object.keys(rawRows).slice(0, 5).join(',') : ''));
    console.log('[richardson-sync] feed rows:', rawRows.length);
    if (rawRows.length > 0) {
      console.log('[richardson-sync] first row keys:', Object.keys(rawRows[0]).join(', '));
      console.log('[richardson-sync] first row sample:', JSON.stringify(rawRows[0]).slice(0, 300));
    }

    // 3. Group by style → color → sizes
    const byStyle = {};
    let skippedNoStyle = 0, skippedNoColorSize = 0;
    for (const row of rawRows) {
      const style = String(row.Style || row.style || '').trim();
      if (!style) { skippedNoStyle++; continue; }
      const desc = row.Description || row.description || '';
      const { color, size } = parseDescription(desc, style);
      if (!color || !size) { skippedNoColorSize++; continue; }
      const qty = (parseInt(row['Oregon DC'] || row['OregonDC'] || row.oregon_dc || 0)) + (parseInt(row['Texas DC'] || row['TexasDC'] || row.texas_dc || 0));
      const nextAvail = toISODate(String(row['Next Avail'] || row['NextAvail'] || row.next_avail || ''));
      const sku = String(row.SKU || row.sku || '').trim();
      const upc = String(row.UPC || row.upc || '').trim();
      if (!byStyle[style]) byStyle[style] = {};
      const byColor = byStyle[style];
      if (!byColor[color]) byColor[color] = { variants: [], firstSku: sku };
      byColor[color].variants.push({ size, qty, nextAvail, sku, upc });
    }

    const styles = Object.keys(byStyle);
    console.log('[richardson-sync] styles:', styles.length, '| skippedNoStyle:', skippedNoStyle, '| skippedNoColorSize:', skippedNoColorSize);

    let productsUpserted = 0, invRows = 0;
    const errors = [];

    // 4. Build product + inventory upserts
    const prodRows = [];
    const invUpserts = [];
    for (const style of styles) {
      try {
        const cost = getLevel4Price(style);
        const retail = cost ? Math.round(cost * 2 * 100) / 100 : null;
        for (const [color, grp] of Object.entries(byStyle[style])) {
          const colorSlug = color.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 40) || 'NA';
          const productSku = style + '-' + colorSlug;
          const productId = 'rich-' + productSku;
          const category = mapCategory(style, color);
          const sizes = [...new Set(grp.variants.map((v) => v.size))];
          const driveId = DRIVE_IMAGES[style];
          prodRows.push({
            id: productId,
            vendor_id: vendorId,
            sku: productSku,
            // Name is the style only (no color) so LiveLook groups every colorway
            // into one card with a color picker, instead of one card per color.
            // The color lives in its own field below.
            name: 'Richardson ' + style,
            brand: 'Richardson',
            color,
            category,
            retail_price: retail,
            nsa_cost: cost,
            catalog_sell_price: cost ? Math.round(cost * 1.65 * 100) / 100 : null,
            is_active: true,
            available_sizes: sizes,
            inventory_source: 'richardson',
            ...(driveId ? { image_front_url: DRIVE_IMAGE_BASE + driveId + DRIVE_IMAGE_SIZE } : {}),
          });
          for (const v of grp.variants) {
            const invId = productSku + '-' + v.size;
            invUpserts.push({
              id: invId,
              sku: productSku,
              size: v.size,
              stock_qty: v.qty,
              future_delivery_date: v.qty === 0 ? v.nextAvail : null,
              future_delivery_qty: null,
              last_synced: new Date().toISOString(),
              source: 'richardson',
              style_number: style,
              color_code: colorSlug,
              upc: v.upc || null,
            });
          }
        }
      } catch (e) {
        errors.push(style + ': ' + e.message);
        if (errors.length > 30) break;
      }
    }

    // 5. Upsert in batches of 500
    for (let i = 0; i < prodRows.length; i += 500) {
      const pr = await sb('products?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(prodRows.slice(i, i + 500)),
      });
      if (!pr.ok) throw new Error('products upsert ' + pr.status + ': ' + (await pr.text()).slice(0, 200));
      productsUpserted += prodRows.slice(i, i + 500).length;
    }
    for (let i = 0; i < invUpserts.length; i += 500) {
      const ir = await sb('richardson_inventory?on_conflict=sku,size', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(invUpserts.slice(i, i + 500)),
      });
      if (!ir.ok) throw new Error('inventory upsert ' + ir.status + ': ' + (await ir.text()).slice(0, 200));
      invRows += invUpserts.slice(i, i + 500).length;
    }

    console.log('[richardson-sync] done:', productsUpserted, 'products,', invRows, 'inventory rows,', errors.length, 'errors');
    return { statusCode: 200, body: JSON.stringify({ styles: styles.length, products: productsUpserted, inventory_rows: invRows, errors: errors.slice(0, 10) }) };
  } catch (e) {
    console.error('[richardson-sync]', e);
    return { statusCode: 500, body: e.message };
  }
};
