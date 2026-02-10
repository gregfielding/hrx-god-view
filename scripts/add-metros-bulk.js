#!/usr/bin/env node
/**
 * Append new metro definitions to src/data/metroTemplates.json.
 * Run from repo root: node scripts/add-metros-bulk.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FILE = path.join(REPO_ROOT, 'src/data/metroTemplates.json');

const EXISTING_KEYS = new Set([
  'dallas_fort_worth', 'austin', 'houston', 'san_antonio', 'chicago', 'los_angeles',
  'salt_lake_city', 'san_francisco_bay_area'
]);

const NEW_METROS = [
  { metroKey: 'indianapolis', label: 'Indianapolis', subareas: [
    { subareaKey: 'central', label: 'Indianapolis (city)', cityKeys: ['indianapolis_in'] },
    { subareaKey: 'north', label: 'North / Carmel / Fishers', cityKeys: ['carmel_in', 'fishers_in', 'noblesville_in', 'westfield_in', 'zionsville_in', 'anderson_in'] },
    { subareaKey: 'south', label: 'South / Greenwood', cityKeys: ['greenwood_in', 'franklin_in', 'martinsville_in'] },
    { subareaKey: 'east', label: 'East', cityKeys: ['lawrence_in', 'greenfield_in', 'new_castle_in'] },
    { subareaKey: 'west', label: 'West / Avon / Plainfield', cityKeys: ['avon_in', 'plainfield_in', 'brownsburg_in', 'danville_in'] }
  ]},
  { metroKey: 'oklahoma_city', label: 'Oklahoma City', subareas: [
    { subareaKey: 'central', label: 'Oklahoma City', cityKeys: ['oklahoma_city_ok', 'edmond_ok', 'norman_ok', 'midwest_city_ok', 'del_city_ok'] },
    { subareaKey: 'suburbs', label: 'Suburbs', cityKeys: ['bethany_ok', 'choctaw_ok', 'el_reno_ok', 'guthrie_ok', 'moore_ok', 'mustang_ok', 'newcastle_ok', 'yukon_ok'] }
  ]},
  { metroKey: 'tulsa', label: 'Tulsa', subareas: [
    { subareaKey: 'tulsa', label: 'Tulsa', cityKeys: ['tulsa_ok', 'broken_arrow_ok', 'bixby_ok', 'jenks_ok', 'owasso_ok', 'sapulpa_ok', 'sand_springs_ok', 'claremore_ok', 'muskogee_ok'] }
  ]},
  { metroKey: 'kansas_city', label: 'Kansas City', subareas: [
    { subareaKey: 'kc_mo', label: 'Kansas City MO', cityKeys: ['kansas_city_mo', 'independence_mo', 'lees_summit_mo', 'blue_springs_mo', 'raytown_mo', 'gladstone_mo', 'north_kansas_city_mo'] },
    { subareaKey: 'kc_ks', label: 'Kansas Side', cityKeys: ['overland_park_ks', 'olathe_ks', 'kansas_city_ks', 'shawnee_ks', 'lenexa_ks', 'lawrence_ks', 'mission_ks', 'prairie_village_ks'] }
  ]},
  { metroKey: 'st_louis', label: 'St. Louis', subareas: [
    { subareaKey: 'st_louis', label: 'St. Louis (city)', cityKeys: ['st_louis_mo'] },
    { subareaKey: 'mo_suburbs', label: 'Missouri Suburbs', cityKeys: ['chesterfield_mo', 'ballwin_mo', 'florissant_mo', 'o_fallon_mo', 'st_charles_mo', 'creve_coeur_mo', 'kirkwood_mo', 'webster_groves_mo', 'university_city_mo'] },
    { subareaKey: 'il_metro_east', label: 'Illinois Metro East', cityKeys: ['belleville_il', 'east_st_louis_il', 'collinsville_il', 'edwardsville_il', 'fairview_heights_il', 'granite_city_il', 'o_fallon_il'] }
  ]},
  { metroKey: 'albuquerque', label: 'Albuquerque', subareas: [
    { subareaKey: 'albuquerque', label: 'Albuquerque', cityKeys: ['albuquerque_nm', 'rio_rancho_nm', 'bernalillo_nm', 'los_lunas_nm', 'belen_nm'] }
  ]},
  { metroKey: 'santa_fe', label: 'Santa Fe', subareas: [
    { subareaKey: 'santa_fe', label: 'Santa Fe', cityKeys: ['santa_fe_nm', 'los_alamos_nm', 'espanola_nm', 'taos_nm'] }
  ]},
  { metroKey: 'phoenix', label: 'Phoenix', subareas: [
    { subareaKey: 'phoenix', label: 'Phoenix (city)', cityKeys: ['phoenix_az'] },
    { subareaKey: 'east_valley', label: 'East Valley', cityKeys: ['mesa_az', 'tempe_az', 'chandler_az', 'gilbert_az', 'scottsdale_az', 'apache_junction_az', 'queen_creek_az'] },
    { subareaKey: 'west_valley', label: 'West Valley', cityKeys: ['glendale_az', 'peoria_az', 'surprise_az', 'goodyear_az', 'avondale_az', 'buckeye_az'] },
    { subareaKey: 'north', label: 'North Valley', cityKeys: ['cave_creek_az', 'anthem_az', 'carefree_az'] }
  ]},
  { metroKey: 'tucson', label: 'Tucson', subareas: [
    { subareaKey: 'tucson', label: 'Tucson', cityKeys: ['tucson_az', 'casa_grande_az', 'marana_az', 'oro_valley_az', 'sahuarita_az', 'south_tucson_az'] }
  ]},
  { metroKey: 'wichita', label: 'Wichita', subareas: [
    { subareaKey: 'wichita', label: 'Wichita', cityKeys: ['wichita_ks', 'derby_ks', 'haysville_ks', 'andover_ks', 'bel_aire_ks', 'park_city_ks'] }
  ]},
  { metroKey: 'denver', label: 'Denver', subareas: [
    { subareaKey: 'denver', label: 'Denver (city)', cityKeys: ['denver_co'] },
    { subareaKey: 'north', label: 'North Metro', cityKeys: ['thornton_co', 'westminster_co', 'northglenn_co', 'broomfield_co'] },
    { subareaKey: 'south', label: 'South Metro', cityKeys: ['littleton_co', 'englewood_co', 'centennial_co', 'parker_co', 'castle_rock_co', 'highlands_ranch_co'] },
    { subareaKey: 'west', label: 'West / Jefferson County', cityKeys: ['lakewood_co', 'arvada_co', 'golden_co', 'wheat_ridge_co'] },
    { subareaKey: 'east', label: 'East / Aurora', cityKeys: ['aurora_co', 'commerce_city_co', 'brighton_co', 'bennett_co'] }
  ]},
  { metroKey: 'colorado_springs', label: 'Colorado Springs', subareas: [
    { subareaKey: 'colorado_springs', label: 'Colorado Springs', cityKeys: ['colorado_springs_co', 'fountain_co', 'manitou_springs_co', 'monument_co', 'security_widefield_co'] }
  ]},
  { metroKey: 'boulder', label: 'Boulder', subareas: [
    { subareaKey: 'boulder', label: 'Boulder', cityKeys: ['boulder_co', 'longmont_co', 'louisville_co', 'lafayette_co', 'superior_co', 'erie_co', 'lyons_co'] }
  ]},
  { metroKey: 'fort_collins', label: 'Fort Collins', subareas: [
    { subareaKey: 'fort_collins', label: 'Fort Collins', cityKeys: ['fort_collins_co', 'loveland_co', 'greeley_co', 'windsor_co', 'timnath_co'] }
  ]},
  { metroKey: 'st_george', label: 'St. George', subareas: [
    { subareaKey: 'st_george', label: 'St. George', cityKeys: ['st_george_ut', 'washington_ut', 'hurricane_ut', 'cedar_city_ut'] }
  ]},
  { metroKey: 'las_vegas', label: 'Las Vegas', subareas: [
    { subareaKey: 'las_vegas', label: 'Las Vegas', cityKeys: ['las_vegas_nv', 'henderson_nv', 'north_las_vegas_nv', 'paradise_nv', 'spring_valley_nv', 'summerlin_nv', 'boulder_city_nv'] }
  ]},
  { metroKey: 'reno', label: 'Reno', subareas: [
    { subareaKey: 'reno', label: 'Reno', cityKeys: ['reno_nv', 'sparks_nv', 'carson_city_nv', 'lake_tahoe_nv', 'tahoe_city_ca'] }
  ]},
  { metroKey: 'san_diego', label: 'San Diego', subareas: [
    { subareaKey: 'san_diego', label: 'San Diego (city)', cityKeys: ['san_diego_ca'] },
    { subareaKey: 'north_county', label: 'North County', cityKeys: ['carlsbad_ca', 'encinitas_ca', 'escondido_ca', 'oceanside_ca', 'san_marcos_ca', 'vista_ca', 'fallbrook_ca'] },
    { subareaKey: 'east_county', label: 'East County', cityKeys: ['el_cajon_ca', 'la_mesa_ca', 'santee_ca', 'lakeside_ca'] },
    { subareaKey: 'south_bay', label: 'South Bay', cityKeys: ['chula_vista_ca', 'national_city_ca', 'imperial_beach_ca', 'bonita_ca'] }
  ]},
  { metroKey: 'sacramento', label: 'Sacramento', subareas: [
    { subareaKey: 'sacramento', label: 'Sacramento (city)', cityKeys: ['sacramento_ca'] },
    { subareaKey: 'placer', label: 'Placer / Roseville', cityKeys: ['roseville_ca', 'rocklin_ca', 'lincoln_ca', 'auburn_ca'] },
    { subareaKey: 'el_dorado', label: 'El Dorado Hills', cityKeys: ['el_dorado_hills_ca', 'placerville_ca', 'folsom_ca'] },
    { subareaKey: 'yolo', label: 'Yolo / Davis', cityKeys: ['davis_ca', 'woodland_ca', 'west_sacramento_ca'] },
    { subareaKey: 'stockton', label: 'Stockton Area', cityKeys: ['stockton_ca', 'modesto_ca', 'tracy_ca', 'manteca_ca'] }
  ]},
  { metroKey: 'omaha', label: 'Omaha', subareas: [
    { subareaKey: 'omaha', label: 'Omaha', cityKeys: ['omaha_ne', 'bellevue_ne', 'papillion_ne', 'la_vista_ne', 'council_bluffs_ia', 'fremont_ne'] }
  ]},
  { metroKey: 'des_moines', label: 'Des Moines', subareas: [
    { subareaKey: 'des_moines', label: 'Des Moines', cityKeys: ['des_moines_ia', 'west_des_moines_ia', 'ankeny_ia', 'urbandale_ia', 'clive_ia', 'altoona_ia'] }
  ]},
  { metroKey: 'nashville', label: 'Nashville', subareas: [
    { subareaKey: 'nashville', label: 'Nashville (city)', cityKeys: ['nashville_tn'] },
    { subareaKey: 'suburbs', label: 'Suburbs', cityKeys: ['franklin_tn', 'murfreesboro_tn', 'hendersonville_tn', 'brentwood_tn', 'smyrna_tn', 'la_vergne_tn', 'mount_juliet_tn', 'gallatin_tn', 'clarksville_tn'] }
  ]},
  { metroKey: 'memphis', label: 'Memphis', subareas: [
    { subareaKey: 'memphis', label: 'Memphis', cityKeys: ['memphis_tn', 'bartlett_tn', 'collierville_tn', 'germantown_tn', 'cordova_tn', 'west_memphis_ar', 'southaven_ms'] }
  ]},
  { metroKey: 'birmingham', label: 'Birmingham', subareas: [
    { subareaKey: 'birmingham', label: 'Birmingham', cityKeys: ['birmingham_al', 'hoover_al', 'vestavia_hills_al', 'homewood_al', 'mountain_brook_al', 'trussville_al', 'bessemer_al'] }
  ]},
  { metroKey: 'new_orleans', label: 'New Orleans', subareas: [
    { subareaKey: 'new_orleans', label: 'New Orleans', cityKeys: ['new_orleans_la', 'metairie_la', 'kenner_la', 'slidell_la', 'mandeville_la', 'covington_la', 'gretna_la'] }
  ]},
  { metroKey: 'cincinnati', label: 'Cincinnati', subareas: [
    { subareaKey: 'cincinnati', label: 'Cincinnati (city)', cityKeys: ['cincinnati_oh'] },
    { subareaKey: 'north', label: 'North / Mason', cityKeys: ['mason_oh', 'west_chester_oh', 'fairfield_oh', 'hamilton_oh', 'middletown_oh'] },
    { subareaKey: 'south', label: 'South / NKY', cityKeys: ['covington_ky', 'florence_ky', 'newport_ky', 'fort_thomas_ky', 'burlington_ky'] }
  ]},
  { metroKey: 'milwaukee', label: 'Milwaukee', subareas: [
    { subareaKey: 'milwaukee', label: 'Milwaukee (city)', cityKeys: ['milwaukee_wi'] },
    { subareaKey: 'suburbs', label: 'Suburbs', cityKeys: ['waukesha_wi', 'wauwatosa_wi', 'west_allis_wi', 'greenfield_wi', 'brookfield_wi', 'menomonee_falls_wi', 'new_berlin_wi', 'racine_wi', 'kenosha_wi'] }
  ]},
  { metroKey: 'madison', label: 'Madison', subareas: [
    { subareaKey: 'madison', label: 'Madison', cityKeys: ['madison_wi', 'middleton_wi', 'sun_prairie_wi', 'fitchburg_wi', 'verona_wi', 'waunakee_wi'] }
  ]},
  { metroKey: 'minneapolis', label: 'Minneapolis–St. Paul', subareas: [
    { subareaKey: 'minneapolis', label: 'Minneapolis', cityKeys: ['minneapolis_mn'] },
    { subareaKey: 'st_paul', label: 'St. Paul', cityKeys: ['st_paul_mn'] },
    { subareaKey: 'south', label: 'South Metro', cityKeys: ['bloomington_mn', 'burnsville_mn', 'eden_prairie_mn', 'edina_mn', 'savage_mn', 'lakeville_mn', 'prior_lake_mn'] },
    { subareaKey: 'west', label: 'West Metro', cityKeys: ['plymouth_mn', 'minnetonka_mn', 'st_louis_park_mn', 'hopkins_mn', 'wayzata_mn', 'st_bonifacius_mn'] },
    { subareaKey: 'east', label: 'East Metro', cityKeys: ['woodbury_mn', 'maplewood_mn', 'roseville_mn', 'stillwater_mn', 'oakdale_mn', 'cottage_grove_mn'] },
    { subareaKey: 'north', label: 'North', cityKeys: ['brooklyn_park_mn', 'coon_rapids_mn', 'blaine_mn', 'fridley_mn', 'andover_mn', 'ramsey_mn'] }
  ]},
  { metroKey: 'grand_rapids', label: 'Grand Rapids', subareas: [
    { subareaKey: 'grand_rapids', label: 'Grand Rapids', cityKeys: ['grand_rapids_mi', 'wyoming_mi', 'kentwood_mi', 'walker_mi', 'east_grand_rapids_mi', 'holland_mi', 'muskegon_mi', 'grand_haven_mi'] }
  ]},
  { metroKey: 'sioux_falls', label: 'Sioux Falls', subareas: [
    { subareaKey: 'sioux_falls', label: 'Sioux Falls', cityKeys: ['sioux_falls_sd', 'brandon_sd', 'harrisburg_sd', 'tea_sd'] }
  ]},
  { metroKey: 'detroit', label: 'Detroit', subareas: [
    { subareaKey: 'detroit', label: 'Detroit (city)', cityKeys: ['detroit_mi'] },
    { subareaKey: 'north', label: 'North / Macomb', cityKeys: ['warren_mi', 'sterling_heights_mi', 'troy_mi', 'royal_oak_mi', 'southfield_mi', 'farmington_hills_mi', 'novi_mi', 'livonia_mi'] },
    { subareaKey: 'west', label: 'West / Ann Arbor', cityKeys: ['ann_arbor_mi', 'ypsilanti_mi', 'dearborn_mi', 'dearborn_heights_mi', 'taylor_mi', 'wayne_mi'] },
    { subareaKey: 'south', label: 'Downriver', cityKeys: ['wyandotte_mi', 'lincoln_park_mi', 'allen_park_mi', 'brownstown_mi'] }
  ]},
  { metroKey: 'cleveland', label: 'Cleveland', subareas: [
    { subareaKey: 'cleveland', label: 'Cleveland (city)', cityKeys: ['cleveland_oh'] },
    { subareaKey: 'east', label: 'East Side', cityKeys: ['cleveland_heights_oh', 'east_cleveland_oh', 'euclid_oh', 'mentor_oh', 'willoughby_oh', 'beachwood_oh', 'shaker_heights_oh'] },
    { subareaKey: 'west', label: 'West Side', cityKeys: ['lakewood_oh', 'parma_oh', 'westlake_oh', 'strongsville_oh', 'north_olmsted_oh', 'elyria_oh'] }
  ]},
  { metroKey: 'columbus', label: 'Columbus', subareas: [
    { subareaKey: 'columbus', label: 'Columbus (city)', cityKeys: ['columbus_oh'] },
    { subareaKey: 'suburbs', label: 'Suburbs', cityKeys: ['dublin_oh', 'upper_arlington_oh', 'worthington_oh', 'gahanna_oh', 'reynoldsburg_oh', 'grove_city_oh', 'westerville_oh', 'delaware_oh', 'newark_oh'] }
  ]},
  { metroKey: 'billings', label: 'Billings', subareas: [
    { subareaKey: 'billings', label: 'Billings', cityKeys: ['billings_mt', 'laurel_mt', 'red_lodge_mt'] }
  ]},
  { metroKey: 'bozeman', label: 'Bozeman', subareas: [
    { subareaKey: 'bozeman', label: 'Bozeman', cityKeys: ['bozeman_mt', 'belgrade_mt', 'livingston_mt', 'big_sky_mt'] }
  ]},
  { metroKey: 'santa_cruz_monterey', label: 'Santa Cruz / Monterey', subareas: [
    { subareaKey: 'monterey', label: 'Monterey Peninsula', cityKeys: ['monterey_ca', 'carmel_ca', 'pacific_grove_ca', 'seaside_ca', 'marina_ca'] },
    { subareaKey: 'santa_cruz', label: 'Santa Cruz', cityKeys: ['santa_cruz_ca', 'capitola_ca', 'watsonville_ca', 'scotts_valley_ca', 'aptos_ca'] },
    { subareaKey: 'salinas', label: 'Salinas Valley', cityKeys: ['salinas_ca', 'gilroy_ca', 'hollister_ca'] }
  ]},
  { metroKey: 'boise', label: 'Boise', subareas: [
    { subareaKey: 'boise', label: 'Boise', cityKeys: ['boise_id', 'meridian_id', 'nampa_id', 'caldwell_id', 'eagle_id', 'kuna_id', 'garden_city_id'] }
  ]},
  { metroKey: 'louisville', label: 'Louisville', subareas: [
    { subareaKey: 'louisville', label: 'Louisville', cityKeys: ['louisville_ky', 'jeffersonville_in', 'new_albany_in', 'clarksville_in', 'st_matthews_ky', 'lyndon_ky'] }
  ]},
  { metroKey: 'charlotte', label: 'Charlotte', subareas: [
    { subareaKey: 'charlotte', label: 'Charlotte (city)', cityKeys: ['charlotte_nc'] },
    { subareaKey: 'north', label: 'North / Lake Norman', cityKeys: ['huntersville_nc', 'cornelius_nc', 'davidson_nc', 'kannapolis_nc', 'concord_nc', 'mooresville_nc'] },
    { subareaKey: 'south', label: 'South', cityKeys: ['rock_hill_sc', 'fort_mill_sc', 'matthews_nc', 'monroe_nc', 'indian_trail_nc'] }
  ]},
  { metroKey: 'atlanta', label: 'Atlanta', subareas: [
    { subareaKey: 'atlanta', label: 'Atlanta (city)', cityKeys: ['atlanta_ga'] },
    { subareaKey: 'north', label: 'North Metro', cityKeys: ['alpharetta_ga', 'roswell_ga', 'sandy_springs_ga', 'marietta_ga', 'smyrna_ga', 'dunwoody_ga', 'johns_creek_ga'] },
    { subareaKey: 'east', label: 'East Metro', cityKeys: ['decatur_ga', 'lawrenceville_ga', 'snellville_ga', 'lilburn_ga', 'conyers_ga'] },
    { subareaKey: 'south', label: 'South Metro', cityKeys: ['east_point_ga', 'college_park_ga', 'peachtree_city_ga', 'newnan_ga', 'fayetteville_ga'] },
    { subareaKey: 'west', label: 'West Metro', cityKeys: ['douglasville_ga', 'mableton_ga', 'austell_ga', 'carrollton_ga'] }
  ]},
  { metroKey: 'jacksonville', label: 'Jacksonville', subareas: [
    { subareaKey: 'jacksonville', label: 'Jacksonville', cityKeys: ['jacksonville_fl', 'jacksonville_beach_fl', 'atlantic_beach_fl', 'orange_park_fl', 'st_augustine_fl', 'fernandina_beach_fl'] }
  ]},
  { metroKey: 'tampa', label: 'Tampa Bay', subareas: [
    { subareaKey: 'tampa', label: 'Tampa', cityKeys: ['tampa_fl', 'st_petersburg_fl', 'clearwater_fl', 'largo_fl', 'brandon_fl', 'plant_city_fl'] },
    { subareaKey: 'north', label: 'North / Pasco', cityKeys: ['new_port_richey_fl', 'hudson_fl', 'wesley_chapel_fl', 'land_o_lakes_fl'] },
    { subareaKey: 'south', label: 'South / Sarasota', cityKeys: ['sarasota_fl', 'bradenton_fl', 'venice_fl', 'palmetto_fl'] }
  ]},
  { metroKey: 'miami', label: 'Miami', subareas: [
    { subareaKey: 'miami', label: 'Miami (city)', cityKeys: ['miami_fl'] },
    { subareaKey: 'north', label: 'North / Fort Lauderdale', cityKeys: ['fort_lauderdale_fl', 'hollywood_fl', 'pompano_beach_fl', 'deerfield_beach_fl', 'boca_raton_fl', 'coral_springs_fl'] },
    { subareaKey: 'south', label: 'South / Homestead', cityKeys: ['homestead_fl', 'kendall_fl', 'miami_beach_fl', 'key_biscayne_fl', 'coral_gables_fl'] },
    { subareaKey: 'west', label: 'West', cityKeys: ['miami_lakes_fl', 'hialeah_fl', 'doral_fl', 'weston_fl', 'pembroke_pines_fl', 'miramar_fl'] }
  ]}
];

function main() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const data = JSON.parse(raw);
  const existingKeys = new Set(data.map((m) => m.metroKey));
  let added = 0;
  for (const metro of NEW_METROS) {
    if (existingKeys.has(metro.metroKey)) continue;
    data.push(metro);
    existingKeys.add(metro.metroKey);
    added++;
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Added', added, 'new metros. Total:', data.length);
}

main();
