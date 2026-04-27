/* eslint-disable */
// Pure data constants extracted from App.js

export const _pick=(obj,cols)=>{const r={};cols.forEach(c=>{if(c in obj)r[c]=obj[c]});return r};
export const _estCols=['id','customer_id','memo','status','created_by','created_at','updated_at','default_markup','shipping_type','shipping_value','ship_to_id','email_status','email_sent_at','email_opened_at','email_viewed_at','follow_up_at','sent_history','print_history','deleted_at','promo_applied','promo_amount','update_requests','approved_by','approved_at','credit_applied','credit_amount'];
export const _soCols=['id','customer_id','estimate_id','memo','status','created_by','created_at','updated_at','expected_date','production_notes','shipping_type','shipping_value','ship_to_id','default_markup','omg_store_id','_shipstation_order_id','_shipping_status','_tracking_number','_carrier','_ship_date','_tracking_url','_shipped','_shipments','_shipping_cost','_shipstation_cost','_inbound_freight','deleted_at','promo_applied','promo_amount','ship_preference','ship_on_date','order_type','expected_ship_date','booking_confirmed','booking_confirmed_at','booking_confirmed_by','booking_alert_days','po_number','tax_rate','tax_exempt','email_status','email_sent_at','email_opened_at','email_viewed_at','follow_up_at','sent_history','print_history','credit_applied','credit_amount','deco_pos'];
export const _itemCols=['product_id','sku','name','brand','color','vendor_id','nsa_cost','retail_price','unit_sell','sizes','available_sizes','_colors','no_deco','notes','is_custom','custom_desc','custom_cost','custom_sell','is_promo','_pre_promo_sell','est_qty','size_availability','_colorImage','_colorBackImage','_ss_live','_sm_live','_mt_live','_mtId','_sizeCosts'];
export const _decoCols=['kind','position','type','art_file_id','art_tbd_type','tbd_colors','tbd_stitches','tbd_dtf_size','sell_override','sell_each','cost_each','underbase','two_color','colors','stitches','dtf_size','num_method','num_size','num_size_back','num_font','roster','names','vendor','deco_type','notes','custom_font_art_id','print_color','front_and_back','reversible','num_qty','name_qty','color_way_id'];
// NOTE: names_list (jsonb) and _cost_locked (boolean) exist in DB but PostgREST schema cache hasn't picked them up yet — add back here once Supabase refreshes
// Columns that may not exist in production DB / schema cache — stripped on insert retry
export const _itemExtraCols=new Set(['is_promo','_pre_promo_sell','est_qty','size_availability','_colorImage','_colorBackImage','notes','_ss_live','_sm_live','_mt_live','_mtId','_sizeCosts']);
export const _estExtraCols=new Set(['promo_applied','promo_amount','update_requests','email_sent_at','email_opened_at','email_viewed_at','follow_up_at','sent_history','print_history','approved_by','approved_at','credit_applied','credit_amount']);
export const _soExtraCols=new Set(['_shipping_cost','_shipstation_cost','_inbound_freight','promo_applied','promo_amount','ship_preference','ship_on_date','order_type','expected_ship_date','booking_confirmed','booking_confirmed_at','booking_confirmed_by','booking_alert_days','po_number','tax_rate','tax_exempt','email_status','email_sent_at','email_opened_at','email_viewed_at','follow_up_at','sent_history','print_history','credit_applied','credit_amount','deco_pos']);
export const _decoExtraCols=new Set(['print_color','front_and_back','reversible','num_qty','name_qty','num_font','num_size_back','custom_font_art_id','deco_type','notes','vendor','color_way_id','_cost_locked','names_list']);
// Sanitize decoration data before DB insert — strip UI-only placeholders that would violate constraints
export const _sanitizeDeco=(d)=>{const r={...d};if(r.custom_font_art_id&&r.custom_font_art_id==='pending')r.custom_font_art_id=null;if(r.art_file_id&&r.art_file_id==='__tbd')r.art_file_id=null;return r};
export const _msgCols=['id','so_id','author_id','text','ts','dept','tagged_members','entity_type','entity_id','thread_id'];
export const _msgExtraCols=new Set(['tagged_members','entity_type','entity_id','thread_id']);
export const _artCols=['id','name','deco_type','ink_colors','thread_colors','stitches','art_size','art_sizes','garment_colors','color_ways','files','mockup_files','item_mockups','sample_art','prod_files','preview_url','notes','status','uploaded'];
// Columns that may not exist in art file tables — stripped on retry
export const _artExtraCols=new Set(['art_sizes','garment_colors','item_mockups','color_ways','preview_url','sample_art','stitches']);
// Columns that may not exist in so_jobs — stripped on retry
export const _jobExtraCols=new Set(['_art_ids','art_requests','art_messages','assigned_artist','rep_notes','rejections','coach_rejected','sent_to_coach_at','coach_approved_at','coach_approval_comment','coach_email_opened_at','follow_up_at','sent_history','run_order','run1_done','run2_done']);
export const _jobCols=['id','key','art_file_id','_art_ids','_draft','art_name','deco_type','positions','art_status','item_status','prod_status','total_units','fulfilled_units','split_from','created_at','assigned_machine','assigned_to','ship_method','items','_auto','art_requests','art_messages','assigned_artist','rep_notes','rejections','coach_rejected','sent_to_coach_at','coach_approved_at','coach_approval_comment','coach_email_opened_at','follow_up_at','sent_history','run_order','run1_done','run2_done','_merged'];
export const _custCols=['id','parent_id','name','alpha_tag','billing_address_line1','billing_address_line2','billing_city','billing_state','billing_zip','shipping_address_line1','shipping_address_line2','shipping_city','shipping_state','shipping_zip','adidas_ua_tier','catalog_markup','payment_terms','tax_rate','tax_exempt','primary_rep_id','notes','is_active','created_at','updated_at','alt_billing_addresses','art_files','pantone_colors','thread_colors','netsuite_internal_id'];

// Pantone color lookup
export const PANTONE_MAP={
'100':'#F4ED7C','101':'#F4ED47','102':'#FAE600','103':'#C6AD0F','104':'#AD9B0E','105':'#82750F',
'106':'#F7E859','107':'#F9E526','108':'#FEDB00','109':'#FFD100','110':'#D8A600','111':'#AA8A00','112':'#9C8412',
'113':'#FAE053','114':'#F9DD16','115':'#FBDB0F','116':'#FFCD00','117':'#C6960C','118':'#AA7D03','119':'#895F00',
'120':'#FBDB65','121':'#F8D54B','122':'#FED100','123':'#FFC72C','124':'#EAAA00','125':'#B58500','126':'#9A7611',
'127':'#F3DD6D','128':'#F5D752','129':'#F8CE46','130':'#F2A900','131':'#CC8A00','132':'#A17400',
'133':'#6E4B00','134':'#FFD87F','135':'#FCC861','136':'#FCBA52','137':'#FCA311','138':'#E57200','139':'#AF6D04',
'140':'#7A5A11','141':'#F4CE79','142':'#F1C75D','143':'#F0BF47','144':'#ED8B00','145':'#CF7F00','146':'#A06E13',
'148':'#FFD691','149':'#FCC97D','150':'#FCAE5A','151':'#FF8200','152':'#E66E00','153':'#BC5F00',
'155':'#F4CB8D','156':'#F4B76A','157':'#EE7624','158':'#E35205','159':'#CB4600','160':'#9B4D1E',
'161':'#612D12','162':'#F7AA7B','163':'#F68B52','164':'#F56600','165':'#FF5F00','166':'#E35205','167':'#BE4D00',
'168':'#6E3219','169':'#F8A3A0','170':'#F48078','171':'#F35B53','172':'#F74902','173':'#CF4520','174':'#963821',
'175':'#6E302A','176':'#F5A5B8','177':'#F48CA6','178':'#F26A7E','179':'#E03C31','180':'#C13828','181':'#81312F',
'182':'#F7B5CC','183':'#F472B2','184':'#F04D98','185':'#E4002B','186':'#CE0037','187':'#AF272F','188':'#7C2B3B',
'189':'#FFA5C8','190':'#F6699A','191':'#F04880','192':'#E40046','193':'#BF0D3E','194':'#992135',
'196':'#F2D1D6','197':'#EC7FA6','198':'#DF1F71','199':'#D50032','200':'#BA0C2F','201':'#9B2335','202':'#862633',
'203':'#ECABBE','204':'#E96FA0','205':'#E54C82','206':'#D6004D','207':'#A50040','208':'#862041',
'209':'#6F2840','210':'#FFA1CB','211':'#FF7CB9','212':'#F75DA8','213':'#E94F8A','214':'#CC0066','215':'#AC145A',
'216':'#7E2D4D','217':'#EABECD','218':'#E54C93','219':'#DA1884','220':'#A70050','221':'#890043',
'222':'#6E273D','223':'#F27CB7','224':'#F04DA1','225':'#E10086','226':'#D60080','227':'#AA0061','228':'#830051',
'229':'#6E2B57','230':'#FFA0D0','231':'#F269B1','232':'#F04DA1','233':'#CE0078','234':'#A00054',
'235':'#82004F','236':'#F580C4','237':'#F25CAE','238':'#E440A0','239':'#CC0088','240':'#AA0070',
'241':'#8F0056','242':'#790049','243':'#F5A9D0','244':'#EB80B5','245':'#DD63A7','246':'#CC00A0',
'247':'#B30090','248':'#990082','249':'#750060','250':'#E8A3C3','251':'#DD80B8','252':'#C44DA0',
'253':'#AF23A5','254':'#A0209D','255':'#78175A',
'256':'#D6A8CA','257':'#C280A7','258':'#8B3D8F','259':'#6D2077','260':'#5C1F64','261':'#55175E',
'262':'#4E1A5F','263':'#CCA8D0','264':'#A870B6','265':'#7B2D8E','266':'#6B1F7C','267':'#5F1D78',
'268':'#4F1A70','269':'#431F60','270':'#B0A1CF','271':'#9485BC','272':'#7566A0','273':'#2E1A6E',
'274':'#281560','275':'#201450','276':'#1A103E','277':'#B4CBE8','278':'#91B2DC','279':'#418FDE',
'280':'#012169','281':'#002868','282':'#002554','283':'#6EAADE','284':'#5B99D6','285':'#0072CE',
'286':'#0033A0','287':'#003DA5','288':'#002D72','289':'#0C2340','290':'#B5D4E8','291':'#A0C8E2',
'292':'#69B3E7','293':'#003DA5','294':'#002F6C','295':'#002244','296':'#041C3C',
'297':'#71C5E8','298':'#41B6E6','299':'#00A3E0','300':'#005EB8','301':'#004C97','302':'#003B5C','303':'#002A3A',
'304':'#A1DAE8','305':'#70CFE9','306':'#00BCE4','307':'#006BA6','308':'#00587C','309':'#003946',
'310':'#6AD1E3','311':'#00B5D6','312':'#00A9CE','313':'#0092BC','314':'#007FA3','315':'#005F7F','316':'#004851',
'317':'#C5E8DB','318':'#8AD9C8','319':'#3CC9AD','320':'#009B8D','321':'#008675','322':'#006F62',
'323':'#005E56','324':'#A5DFD3','325':'#64CDB4','326':'#00B189','327':'#009B77','328':'#007B5F',
'329':'#006747','330':'#00503E','331':'#ADDFCE','332':'#91DCBA','333':'#3CC9A7','334':'#009A63',
'335':'#007A53','336':'#00614B','337':'#8FD5B2','338':'#6EC9A0','339':'#00B27A','340':'#00965E',
'341':'#007A4D','342':'#006B3F','343':'#005436','344':'#A3DDBB','345':'#7FD2A0','346':'#60C882',
'347':'#009B48','348':'#008542','349':'#006B38','350':'#254E2E',
'351':'#86E6B0','352':'#62E098','353':'#3DD68F','354':'#00B140','355':'#009639','356':'#007A33','357':'#215732',
'358':'#A4D867','359':'#A0D44E','360':'#6CC24A','361':'#43B02A','362':'#339E35','363':'#2C8C34',
'364':'#3A7D44','365':'#C0E66E','366':'#B7DB3B','367':'#A4D233','368':'#78BE20','369':'#64A70B',
'370':'#5B8F22','371':'#4C6A2D','372':'#D4EB8E','373':'#CEDC00','374':'#C5D600','375':'#97D700',
'376':'#84BD00','377':'#6E9B2D','378':'#4E5E2F',
'379':'#E0E84E','380':'#D2D755','381':'#CEDC00','382':'#C1D100','383':'#A3AA00','384':'#8A8D00',
'385':'#707219','386':'#E6EB58','387':'#E1E733','388':'#D3D800','389':'#C9CF22','390':'#9EA700',
'391':'#808600','392':'#767100',
'393':'#F2EA74','394':'#EDEA00','395':'#F0EC1F','396':'#E3E935','397':'#BCC600','398':'#ADB300',
'399':'#9B9A09',
'400':'#C4B9A7','401':'#B0A696','402':'#A39B8B','403':'#948777','404':'#857362','405':'#696158',
'406':'#C9BEB5','407':'#B2A497','408':'#A39283','409':'#92817A','410':'#7A6B63','411':'#5E514D',
'412':'#382F2C',
'413':'#C7C2B5','414':'#B5AFA3','415':'#A39E92','416':'#908B80','417':'#7A756A','418':'#5E5E57',
'419':'#212721',
'420':'#C9C6C0','421':'#B3B0AB','422':'#A1A09E','423':'#8D8C8C','424':'#747678','425':'#55585A',
'426':'#25282A',
'427':'#CDD5D8','428':'#BBC4C9','429':'#A1ADB3','430':'#7D8B92','431':'#5B6770','432':'#333F48',
'433':'#1D252D',
'434':'#D5C5BD','435':'#C2A8A0','436':'#A88583','437':'#7B4D51','438':'#593536','439':'#463034',
'440':'#3E3135',
'441':'#BCC6C0','442':'#A3B2AD','443':'#8B9D96','444':'#717C7D','445':'#505759','446':'#3D4244',
'447':'#373A36',
'Black':'#2D2926','Black 2':'#332F21','Black 3':'#212721','Black 4':'#31261D','Black 5':'#3E3135',
'Black 6':'#101820','Black 7':'#3D3935',
'White':'#FFFFFF','Cool Gray 1':'#D9D9D6','Cool Gray 2':'#D0D0CE','Cool Gray 3':'#C8C9C7',
'Cool Gray 4':'#BBBCBC','Cool Gray 5':'#B1B3B3','Cool Gray 6':'#A7A8AA','Cool Gray 7':'#97999B',
'Cool Gray 8':'#888B8D','Cool Gray 9':'#75787B','Cool Gray 10':'#63666A','Cool Gray 11':'#53565A',
'Warm Gray 1':'#D7D2CB','Warm Gray 2':'#CBC4BC','Warm Gray 3':'#BFB8AF','Warm Gray 4':'#B6ADA5',
'Warm Gray 5':'#ACA39A','Warm Gray 6':'#A59C94','Warm Gray 7':'#968C83','Warm Gray 8':'#8C8279',
'Warm Gray 9':'#83786F','Warm Gray 10':'#796E65','Warm Gray 11':'#6E6259',
'Reflex Blue':'#001489','Process Blue':'#0085CA','Rubine Red':'#CE0058','Rhodamine Red':'#E10098',
'Purple':'#BB29BB','Green':'#00AB84','Orange 021':'#FE5000','Red 032':'#EF3340',
'Yellow':'#FEDD00','Warm Red':'#F9423A','Violet':'#440099',
'448':'#4A412A','449':'#524727','450':'#594A25','451':'#9B8E55','452':'#B5A679','453':'#BFB68A','454':'#C9BA8C',
'455':'#6B5C27','456':'#998542','457':'#B58B00','458':'#DCCA6A','459':'#E0CB73','460':'#C4AD68','461':'#C1A64D',
'462':'#5B4723','463':'#6C4F27','464':'#7A5A2D','465':'#C1A367','466':'#C9B27C','467':'#C6AA76','468':'#DDCDA5',
'469':'#6E4827','470':'#A05E3A','471':'#B56631','472':'#EAA566','473':'#F0BA8D','474':'#EDAC73','475':'#D9874E',
'476':'#5A3E35','477':'#633F2F','478':'#6B3D2E','479':'#AA7C60','480':'#C49E81','481':'#C9A282','482':'#CDA97F',
'483':'#6B3028','484':'#9B3325','485':'#DA291C','486':'#ED7B68','487':'#F0887D','488':'#EC9181','489':'#EDB5A0',
'490':'#5D2837','491':'#7C2D3D','492':'#8E2A44','493':'#DC7E8D','494':'#F0A0AE','495':'#F4ACB8','496':'#F5B5BD',
'497':'#512E3A',
'500':'#6D2C45','501':'#D094A8','502':'#E4ADB9','503':'#E8B4C0','504':'#6E253C',
'505':'#7E2242','506':'#8C2548','507':'#D697A8','508':'#E8B3C0','509':'#E6B0BE',
'510':'#C87FA3','511':'#6E2367','512':'#82288E','513':'#993CA1','514':'#C377B5','515':'#D9A8C9',
'516':'#E5BFD6','517':'#D1A3C0','518':'#563357','519':'#612D6D','520':'#632D6C',
'521':'#A877B0','522':'#9561A8','523':'#8E50A0','524':'#C8A2D2','525':'#802F8D','526':'#7D1E8E',
'527':'#7C1E8F','528':'#A87BBD','529':'#C1A0D0','530':'#BE93CC',
'531':'#C9AAD7','532':'#2A2E38','533':'#263147','534':'#253659','535':'#9CADC4','536':'#A5B4C6',
'537':'#C0CDDB','538':'#8AA1B4','539':'#003F5F','540':'#00364A','541':'#003C71',
'542':'#5B9ECF','543':'#A2C5E0','544':'#B4D0E2','545':'#C1D7E2',
'546':'#00383C','547':'#00424A','548':'#004B58','549':'#6FA5B4','550':'#83ACBB','551':'#A3C0C0',
'552':'#B2C9C4','553':'#1F5C4C','554':'#28635B','555':'#337366','556':'#7DA894','557':'#99BBA4',
'558':'#A5C5B0','559':'#B6D1C1','560':'#1C5E4D','561':'#00685F','562':'#007B6C','563':'#80C0A0',
'564':'#86C8B0','565':'#A8DAC4','566':'#C2E4D3','567':'#1B5E4F',
'568':'#00756F','569':'#008C7E','570':'#7FC4B8','571':'#A0D4C8','572':'#B2DDD1','573':'#BFE1D6',
'574':'#4A652C','575':'#527A3D','576':'#5A8240','577':'#B0CC8E','578':'#B8D28E','579':'#AEC886',
'580':'#C1D470','581':'#6A7E1F','582':'#758E14','583':'#8FA01A','584':'#C9D850','585':'#D5E05C',
'586':'#D8E36E','587':'#DCE678',
'598':'#73C6C0','599':'#4BC3C6',
'600':'#CAE0E0','601':'#D3E5A0','602':'#D9E860','603':'#E0EC3F','604':'#E3ED27','605':'#D7E318','606':'#CDDB00',
'607':'#E4EB9A','608':'#E1EB70','609':'#DDEA3C','610':'#D5E100','611':'#C4D600','612':'#B0C400',
'613':'#9AAE07','614':'#D5D972','615':'#C7CC67','616':'#BCBE56','617':'#ACA73A','618':'#918B24','619':'#747014',
'620':'#BAC0B3','621':'#BCC9BB','622':'#9DB4A2','623':'#7B9D8B','624':'#5A8272','625':'#2E6552','626':'#134533',
'627':'#0A2A1D','628':'#99D1D9','629':'#76C1D0','630':'#3FB1C5','631':'#0099B4','632':'#007EA3','633':'#005C7E',
'634':'#003D56','635':'#A4DAE2','636':'#87CEDB','637':'#4CB8D4','638':'#00A0C6','639':'#0087AC',
'640':'#006E8E','641':'#003B5C','642':'#C7D4E2','643':'#AFBDD1','644':'#8DA3BE','645':'#6F88A4',
'646':'#6082A5','647':'#24496B','648':'#002A4E','649':'#CDD2DC','650':'#B9BFD0','651':'#97A4BC',
'652':'#6C7FA8','653':'#33558D','654':'#003070','655':'#002359',
'656':'#D1D8E5','657':'#BCC3DD','658':'#A5ADD2','659':'#7D8BC1','660':'#5468A5','661':'#233B87',
'662':'#152561','663':'#D9B9C5','664':'#D6B3BF','665':'#BE91A8','666':'#9E6B8A','667':'#7A4F76',
'668':'#5E3968','669':'#3E2152',
'670':'#E8B7BD','671':'#EBA1B0','672':'#E685A0','673':'#DD6189','674':'#C74375','675':'#A21850',
'676':'#810040','677':'#E8C3C3','678':'#F0C9C7','679':'#EBB2B7','680':'#C67885','681':'#A9526B',
'682':'#903458','683':'#752043',
'684':'#E6B7BC','685':'#DC96A0','686':'#D4808F','687':'#C25B73','688':'#A34066','689':'#852150',
'690':'#6E1D40',
'691':'#EBC7C0','692':'#E2A9A1','693':'#CE7D7C','694':'#D3818E','695':'#A8445B','696':'#8B2E4B',
'697':'#7E2742',
'698':'#F2C4C2','699':'#F2AAAC','700':'#EF6266','701':'#CC3340','702':'#BD1F36','703':'#A31A32',
'704':'#8D1B3D',
'705':'#F9D7D2','706':'#F9ADAF','707':'#EF5C7A','708':'#E93465','709':'#D70047','710':'#BE0040',
'711':'#A10038',
'712':'#FDCC8A','713':'#F9B668','714':'#F8A050','715':'#F0883E','716':'#EA7125','717':'#D56800',
'718':'#CF4F00','719':'#EDCE9E','720':'#E5BD86','721':'#C6946B','722':'#A36E47','723':'#8B5930',
'724':'#704320','725':'#5C3617',
'726':'#D1B89C','727':'#C19971','728':'#B17F4D','729':'#A06A32',
'730':'#D4A168','731':'#A76F3B','732':'#6E4524',
'733':'#C5902C','734':'#D09E38','735':'#DCAE4C',
// 7400-7547 extended gamut
'7400':'#E0C968','7401':'#F0DC82','7402':'#E5C64A','7403':'#E8C64A','7404':'#F2D000','7405':'#F2CA00','7406':'#F0C800',
'7407':'#C59E5E','7408':'#E89C28','7409':'#E89220','7410':'#E8975B','7411':'#D08845','7412':'#C07428',
'7413':'#C06028','7414':'#B87040',
'7415':'#E0A89E','7416':'#D04030','7417':'#C83C28','7418':'#B84060','7419':'#A83858','7420':'#A02848',
'7421':'#601828','7422':'#F08888','7423':'#D83060','7424':'#C82050','7425':'#B02048','7426':'#A01838',
'7427':'#881828','7428':'#C8B0A8','7429':'#C89898','7430':'#C88090','7431':'#C06878','7432':'#A85068',
'7433':'#982050','7434':'#881848',
'7435':'#D8A0B8','7436':'#E8B0C8','7437':'#C088A8','7438':'#D878A8','7439':'#B090A0','7440':'#C0A0B8',
'7441':'#C080E0','7442':'#A848D0','7443':'#C0B8D0','7444':'#A0A0C8','7445':'#B0A0C0','7446':'#8880B8',
'7447':'#504078',
'7448':'#404828','7449':'#503820','7450':'#A0B0C0','7451':'#80B0E0','7452':'#8098E0','7453':'#80C0E8',
'7454':'#68A8C0','7455':'#3860B0','7456':'#7880C0','7457':'#E0E8A0','7458':'#60A8B8','7459':'#287898',
'7460':'#0080A0','7461':'#1888B8','7462':'#185078','7463':'#103048','7464':'#80C0A8','7465':'#30B898',
'7466':'#00B0C0','7467':'#00A0A8','7468':'#007098','7469':'#185068',
'7470':'#409090','7471':'#70D0B8','7472':'#58B0A0','7473':'#288070','7474':'#006860','7475':'#487878',
'7476':'#184040','7477':'#3A6870','7478':'#80E0A0','7479':'#48D858','7480':'#00C060','7481':'#00B84C',
'7482':'#00A048','7483':'#304828','7484':'#006848','7485':'#C8E0B8','7486':'#A0E080','7487':'#70D068',
'7488':'#48C848','7489':'#609850','7490':'#789850','7491':'#A0B870',
'7492':'#C0CC70','7493':'#D0D8A8','7494':'#A8C890','7495':'#788838','7496':'#488018','7497':'#A89878',
'7498':'#C0B898','7499':'#F0E8C0','7500':'#E0D8C0','7501':'#E8D8B8','7502':'#D8C498','7503':'#B8A070',
'7504':'#C09880','7505':'#A87858','7506':'#F0D8B0','7507':'#F8C880','7508':'#E8A858','7509':'#D89048',
'7510':'#C87838','7511':'#B86828','7512':'#A85828','7513':'#E0A888','7514':'#D09878','7515':'#C08868',
'7516':'#885030','7517':'#804028','7518':'#785048','7519':'#604038','7520':'#E8B8A8','7521':'#C09890',
'7522':'#B06860','7523':'#A84848','7524':'#A85058','7525':'#B07050','7526':'#904028',
'7527':'#D8D0C0','7528':'#C8B8A8','7529':'#B0A090','7530':'#A09080','7531':'#887870','7532':'#685848',
'7533':'#403028','7534':'#D0C0A8','7535':'#B8A890','7536':'#A89878','7537':'#A8B8B0','7538':'#98A8A0',
'7539':'#889890','7540':'#485058','7541':'#D8E0E0','7542':'#A0B8C8','7543':'#98A8B0','7544':'#7890A0',
'7545':'#405060','7546':'#283840','7547':'#182028',
'871':'#84754E','872':'#85714D','873':'#866D4B','874':'#8B6F4E','875':'#87714D','876':'#8B6E4E','877':'#8A8D8F',
// Common TCX/TPX 4-digit colors used in sportswear
'4525':'#8E7961','4515':'#B09E8A','4505':'#C7B9A1','4495':'#D2C4A8','4485':'#DDD0B5',
'4625':'#5C3A1E','4635':'#8B6038','4645':'#A37B4F','4655':'#C4A06E','4665':'#D8BA8A',
'4695':'#3E2415','4705':'#7B4931','4715':'#9E6B47','4725':'#B8895E','4735':'#CCAB82',
'4745':'#DDC5A0','4755':'#E8D4B2'
};
export const pantoneHex=(code)=>{if(!code)return null;const s=code.toString().toUpperCase().replace(/\s*(C|U|CP|UP|TCX|TPX|TPG|TN)\s*$/,'').replace(/^PMS\s*/,'').replace(/^PANTONE\s*/,'').trim();return PANTONE_MAP[s]||PANTONE_MAP[s.replace(/\s+/g,' ')]||null};
export const pantoneSearch=(query)=>{if(!query||query.length<1)return[];const q=query.toUpperCase().replace(/^PMS\s*/,'').replace(/^PANTONE\s*/,'').trim();return Object.entries(PANTONE_MAP).filter(([k])=>k.toUpperCase().includes(q)).slice(0,12).map(([code,hex])=>({code,hex}))};
// Thread color name-to-hex lookup for common embroidery thread colors
export const THREAD_COLORS={'cardinal':'#8C1515','navy':'#001f3f','gold':'#FFD700','white':'#FFFFFF','black':'#000000',
'red':'#dc2626','royal':'#4169e1','royal blue':'#4169e1','silver':'#C0C0C0','green':'#166534','dark green':'#006400',
'orange':'#EA580C','maroon':'#800000','purple':'#6B21A8','kelly green':'#4CBB17','scarlet':'#FF2400',
'columbia blue':'#9BDDFF','light blue':'#ADD8E6','vegas gold':'#C5B358','old gold':'#CFB53B',
'athletic gold':'#FFB81C','charcoal':'#36454F','grey':'#808080','gray':'#808080','light gray':'#C0C0C0',
'pink':'#FF69B4','hot pink':'#FF1493','brown':'#8B4513','cream':'#FFFDD0','tan':'#D2B48C','khaki':'#C3B091',
'teal':'#008080','yellow':'#FFD700','bright yellow':'#FFFF00','powder blue':'#B0E0E6','sky blue':'#87CEEB',
'forest green':'#228B22','lime':'#32CD32','coral':'#FF7F50','wine':'#722F37','burgundy':'#800020',
'rust':'#B7410E','copper':'#B87333','sand':'#C2B280','ivory':'#FFFFF0','slate':'#708090',
'pewter':'#8E8E8E','graphite':'#383838','midnight':'#191970','cobalt':'#0047AB','cyan':'#00FFFF',
'turquoise':'#40E0D0','aqua':'#00FFFF','magenta':'#FF00FF','lavender':'#E6E6FA','lilac':'#C8A2C8',
'violet':'#7F00FF','maize':'#FBEC5D','lemon':'#FFF44F','peach':'#FFCBA4','salmon':'#FA8072',
'brick':'#CB4154','crimson':'#DC143C','berry':'#8E4585','plum':'#DDA0DD','sage':'#BCB88A',
'olive':'#808000','hunter green':'#355E3B','emerald':'#50C878','jade':'#00A86B','mint':'#98FF98',
'seafoam':'#93E9BE','ice blue':'#D6ECEF','baby blue':'#89CFF0','steel blue':'#4682B4',
'denim':'#1560BD','indigo':'#4B0082','eggplant':'#614051','heather':'#B7A99A'};
export const threadHex=(name)=>{if(!name)return null;const n=name.toLowerCase().trim();if(THREAD_COLORS[n])return THREAD_COLORS[n];const match=Object.entries(THREAD_COLORS).find(([k])=>n.includes(k)||k.includes(n));return match?match[1]:null};

export const _vendCols=['id','name','vendor_type','api_provider','nsa_carries_inventory','click_automation','is_active','contact_email','contact_phone','rep_name','payment_terms','notes'];
export const _firmDateCols=['item_desc','date','approved'];
export const _issueCols=['id','status','description','priority','page','viewing','reported_by','role','timestamp','resolved_at','resolution'];
export const _omgStoreCols=['id','store_name','customer_id','rep_id','status','open_date','close_date','orders','total_sales','fundraise_total','items_sold','unique_buyers','_omg_source','_omg_id','_omg_sale_code','_last_synced','subdomain','channel_type','_report_url','_report_id','_report_imported_at','_omg_shipping','_omg_processing','_omg_tax','_omg_fundraise','_omg_grand_total'];

// ─── Team & Company Defaults ───
export const DEFAULT_REPS=[
  // Admins
  {id:'00000000-0000-0000-0000-000000000001',name:'Steve Peterson',role:'admin'},
  {id:'00000000-0000-0000-0000-000000000010',name:'Gayle Peterson',role:'admin'},
  {id:'00000000-0000-0000-0000-000000000011',name:'Mike Peterson',role:'admin'},
  // Sales Reps
  {id:'00000000-0000-0000-0000-000000000020',name:'Chase Koissian',role:'rep'},
  {id:'00000000-0000-0000-0000-000000000021',name:'Jered Hunt',role:'rep'},
  {id:'00000000-0000-0000-0000-000000000022',name:'Mike Mercuriali',role:'rep'},
  {id:'00000000-0000-0000-0000-000000000023',name:'Kevin McCormack',role:'rep'},
  {id:'00000000-0000-0000-0000-000000000024',name:'Jeff Bianchini',role:'rep'},
  {id:'00000000-0000-0000-0000-000000000025',name:'Kelly Bean',role:'rep'},
  // CSR
  {id:'00000000-0000-0000-0000-000000000030',name:'Sharon Day-Monroe',role:'csr'},
  {id:'00000000-0000-0000-0000-000000000031',name:'Rachel Najara',role:'csr'},
  {id:'00000000-0000-0000-0000-000000000032',name:'Tegan Peterson',role:'csr'},
  {id:'00000000-0000-0000-0000-000000000033',name:'Tamara Rodriguez',role:'csr'},
  // Accounting
  {id:'00000000-0000-0000-0000-000000000040',name:'Andrea Jung',role:'accounting'},
  {id:'00000000-0000-0000-0000-000000000041',name:'Ellie Calzada',role:'accounting'},
  // Warehouse
  {id:'00000000-0000-0000-0000-000000000050',name:'Kellen Coates',role:'warehouse'},
  {id:'00000000-0000-0000-0000-000000000051',name:'Noah Corral',role:'warehouse'},
  {id:'00000000-0000-0000-0000-000000000052',name:'Marcel Salceda',role:'warehouse'},
  {id:'00000000-0000-0000-0000-000000000053',name:'Irving Santos',role:'warehouse'},
  // Production managers
  {id:'00000000-0000-0000-0000-000000000058',name:'Dylan Aassness',role:'prod_manager'},
  // Production
  {id:'00000000-0000-0000-0000-000000000060',name:'Paco Salceda',role:'production'},
  {id:'00000000-0000-0000-0000-000000000061',name:'Liliana Moreno',role:'prod_manager'},
  {id:'00000000-0000-0000-0000-000000000062',name:'Fransisco Moreno',role:'production'},
  {id:'00000000-0000-0000-0000-000000000063',name:'Griselda Franco',role:'production'},
  {id:'00000000-0000-0000-0000-000000000064',name:'Luiz Acosta',role:'production'},
  // Production assistants (check-in / count — not assigned jobs directly)
  {id:'00000000-0000-0000-0000-000000000065',name:'Claudia Hernandez',role:'prod_assistant'},
  {id:'00000000-0000-0000-0000-000000000066',name:'Roberto Rivas',role:'prod_assistant'},
  // Artists
  {id:'00000000-0000-0000-0000-000000000070',name:'Mo',role:'art'},
  {id:'00000000-0000-0000-0000-000000000071',name:'Erik',role:'art'},
];
export const NSA_DEFAULTS={name:'National Sports Apparel',legal:'National Sports Apparel LLC',phone:'(619) 555-0127',email:'team@nsa-teamwear.com',
  addr:'9340 Cabot Dr, Suite A',city:'San Diego',state:'CA',zip:'91941',
  fullAddr:'9340 Cabot Dr, Suite A, San Diego, CA 91941',
  logo:'NSA',logoUrl:'/nsa-logo.svg',terms:'Net 30 from invoice date unless otherwise agreed.',
  depositTerms:'50% deposit required to begin production. Balance due upon completion.'};
export const NSA={...NSA_DEFAULTS};

export const ART_LABELS={needs_art:'Needs Art',art_requested:'Art Requested',art_in_progress:'In Progress',waiting_approval:'Waiting Approval',production_files_needed:'Prod Files Needed',art_complete:'Art Complete'};
export const ART_FILE_LABELS={waiting_for_art:'Waiting for Art',needs_approval:'Needs Approval',approved:'Approved / Needs Files'};
export const ART_FILE_SC={waiting_for_art:{bg:'#fef2f2',c:'#dc2626'},needs_approval:{bg:'#fef3c7',c:'#92400e'},approved:{bg:'#dcfce7',c:'#166534'}};

// ═══════════════════════════════════════════════
// PRINT DOCUMENT HELPER — CSS string
// ═══════════════════════════════════════════════
export const PRINT_CSS=`
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px 28px;line-height:1.4}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #ccc}
.logo{display:flex;align-items:center;gap:8px}
.logo img{height:50px}
.co-addr{font-size:11px;color:#333;line-height:1.4}
.co-addr strong{display:block;font-size:12px}
.doc-id{text-align:right}
.doc-id .doc-type{font-size:28px;font-weight:800;color:#333}
.doc-id .doc-num{font-size:14px;color:#333;font-weight:700}
.doc-id .doc-date{font-size:11px;color:#666}
.bill-total{display:flex;justify-content:space-between;align-items:flex-start;margin:8px 0;gap:20px}
.bill-to{flex:1}
.bill-to .label{font-size:10px;font-weight:700;color:#333;background:#e8e8e8;padding:3px 6px;display:inline-block;margin-bottom:4px}
.bill-to .value{font-size:12px;color:#1a1a1a;line-height:1.5}
.total-box{background:#e8e8e8;padding:12px 20px;min-width:200px}
.total-box .tl{font-size:13px;font-weight:800;color:#333}
.total-box .ta{font-size:36px;font-weight:900;color:#1a1a1a;margin:4px 0}
.total-box .ts{font-size:11px;color:#666}
.info-row{display:flex;border:1px solid #ccc;margin-bottom:6px}
.info-cell{flex:1;padding:3px 6px;border-right:1px solid #ccc}
.info-cell:last-child{border-right:none}
.info-cell .label{font-size:9px;font-weight:700;color:#333;background:#e8e8e8;padding:1px 4px;display:inline-block;margin-bottom:2px}
.info-cell .value{font-size:11px;color:#1a1a1a}
table{width:100%;border-collapse:collapse;margin:4px 0}
th{background:#e8e8e8;padding:3px 6px;text-align:left;font-size:10px;font-weight:700;color:#333;border:1px solid #ccc}
td{padding:2px 6px;border-bottom:1px solid #ddd;font-size:10px;line-height:1.3}
.sz-table th,.sz-table td{text-align:center;padding:3px 5px;font-size:10px;min-width:30px}
.sz-table td.has-qty{font-weight:800;color:#1e3a5f;background:#eef2ff}
.totals-row td{font-weight:800;border-top:2px solid #333;font-size:11px}
.notes{margin-top:8px;padding:8px 10px;background:#fffbe6;border:1px solid #f0e6b8;font-size:10px}
.notes .label{font-weight:700;color:#8b6914;margin-bottom:2px}
.footer{margin-top:10px;padding-top:6px;border-top:1px solid #ddd;font-size:8px;color:#999;display:flex;justify-content:space-between}
.amount{text-align:right;font-weight:700}
.highlight{background:#e8e8e8;color:#166534}
.badge{display:inline-block;padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700}
.no-price td:nth-child(n+5){display:none}.no-price th:nth-child(n+5){display:none}
.sep-line{border-top:2px solid #c00;margin:2px 0}
@media print{body{padding:14px 20px}th{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.total-box{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.info-cell .label,.bill-to .label{background:#e8e8e8!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@page{margin:0.4in;size:letter}
`;

export let CATEGORIES=['Tees','Hoodies','Polos','Shorts','1/4 Zips','Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'];
export const COLOR_CATEGORIES=['Black','White','Red','Navy','Royal','Dark Green','Cardinal','Maroon','Light Grey','Dark Grey','Vegas Gold','Athletic Gold','Orange'];

export const EXTRA_SIZES=['XXS','XS','3XL','4XL','5XL','6XL','LT','XLT','2XLT','3XLT','OSFA'];
export const SZ_ORD=['YXS','YS','YM','YL','YXL','YOUTH','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','LT','XLT','2XLT','3XLT','OSFA',
  'XS-SM','S-M','SM-MD','MD-LG','L-XL','LG-XL','XL-2XL',
  '28','30','32','34','36','38','40','42','44','46','48','50','52','54'];
export const SZ_NORM={'XXS':'XXS','2XS':'XXS','SM':'S','SML':'S','SMALL':'S','MD':'M','MED':'M','MEDIUM':'M','LG':'L','LRG':'L','LARGE':'L',
  'XLG':'XL','XLARGE':'XL','X-LARGE':'XL','XXL':'2XL','2X':'2XL','2XLARGE':'2XL','2X-LARGE':'2XL',
  'XXXL':'3XL','3X':'3XL','3XLARGE':'3XL','3X-LARGE':'3XL','XXXXL':'4XL','4X':'4XL','4XLARGE':'4XL','4X-LARGE':'4XL',
  '5X':'5XL','6X':'6XL','LT':'LT','XLT':'XLT','2XLT':'2XLT','3XLT':'3XLT',
  'MENS SMALL':'S','MENS MEDIUM':'M','MENS LARGE':'L','MENS XL':'XL','MENS XXL':'2XL',
  'WOMENS SMALL':'S','WOMENS MEDIUM':'M','WOMENS LARGE':'L','WOMENS XL':'XL',
  'YOUTH SMALL':'YS','YOUTH MEDIUM':'YM','YOUTH LARGE':'YL','YOUTH XL':'YXL',
  'BOYS SMALL':'YS','BOYS MEDIUM':'YM','BOYS LARGE':'YL','GIRLS SMALL':'YS','GIRLS MEDIUM':'YM','GIRLS LARGE':'YL',
  'NONE':'OSFA','ONE SIZE':'OSFA','OS':'OSFA','N/A':'OSFA'};

// Status color/label map
export const SC={
  // SO statuses (5)
  booking:{bg:'#e0e7ff',c:'#4338ca'},need_order:{bg:'#fef3c7',c:'#92400e'},waiting_receive:{bg:'#dbeafe',c:'#1e40af'},needs_pull:{bg:'#fef9c3',c:'#a16207'},items_received:{bg:'#d1fae5',c:'#065f46'},complete:{bg:'#dcfce7',c:'#166534'},in_production:{bg:'#ede9fe',c:'#6d28d9'},ready_to_invoice:{bg:'#fef0c7',c:'#c2410c'},reverted:{bg:'#fef3c7',c:'#d97706'},
  // Job item statuses
  need_to_order:{bg:'#fef3c7',c:'#92400e'},partially_received:{bg:'#fef9c3',c:'#854d0e'},
  // Job production statuses
  draft:{bg:'#fef9c3',c:'#a16207'},ready:{bg:'#dcfce7',c:'#166534'},staging:{bg:'#fef3c7',c:'#92400e'},in_process:{bg:'#dbeafe',c:'#1e40af'},completed:{bg:'#dcfce7',c:'#166534'},shipped:{bg:'#ede9fe',c:'#6d28d9'},
  // Job art statuses
  needs_art:{bg:'#fef2f2',c:'#dc2626'},art_requested:{bg:'#fce7f3',c:'#be185d'},art_in_progress:{bg:'#dbeafe',c:'#1e40af'},waiting_approval:{bg:'#fef3c7',c:'#92400e'},production_files_needed:{bg:'#fef9c3',c:'#854d0e'},art_complete:{bg:'#dcfce7',c:'#166534'},
  // Art file statuses
  waiting_for_art:{bg:'#fef2f2',c:'#dc2626'},needs_approval:{bg:'#fef3c7',c:'#92400e'},
  // Legacy
  uploaded:{bg:'#fef3c7',c:'#92400e'},waiting_art:{bg:'#fef3c7',c:'#92400e'},ready_ship:{bg:'#dcfce7',c:'#166534'},
};

// DATA — sample seeds removed; real data loads from Supabase on startup.
export const D_C=[];
export const BATCH_VENDORS={'sss':{name:'S&S Activewear',threshold:200},'sanmar':{name:'SanMar',threshold:200},'richardson':{name:'Richardson',threshold:200},'momentec':{name:'Momentec',threshold:200},'a4':{name:'A4',threshold:200},'adidas':{name:'Adidas',threshold:0},'under armour':{name:'Under Armour',threshold:0}};
export const MACHINES=[
  {id:'auto_press',name:'Auto Press',type:'screen_print'},
  {id:'manual_press',name:'Manual Press',type:'screen_print'},
  {id:'dtf_printer',name:'DTF Printer',type:'dtf'},
  {id:'heat_press_1',name:'Heat Press 1',type:'heat_transfer'},
  {id:'heat_press_2',name:'Heat Press 2',type:'heat_transfer'},
  {id:'emb_1',name:'Embroidery Head 1',type:'embroidery'},
  {id:'emb_2',name:'Embroidery Head 2',type:'embroidery'},
];
export const D_V=[
{id:'v1',name:'Adidas',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamorders@adidas.com',contact_phone:'800-448-1796',rep_name:'Sarah Johnson',payment_terms:'net60',notes:'Team dealer program.',_oi:3,_it:12450,_ac:4200,_a3:5250,_a6:3000,_a9:0},
{id:'v2',name:'Under Armour',vendor_type:'upload',nsa_carries_inventory:true,click_automation:true,is_active:true,contact_email:'teamdealer@underarmour.com',rep_name:'Mike Daniels',payment_terms:'net60',_oi:2,_it:8200,_ac:5200,_a3:3000,_a6:0,_a9:0},
{id:'v3',name:'SanMar',vendor_type:'api',api_provider:'sanmar',nsa_carries_inventory:false,is_active:true,contact_email:'orders@sanmar.com',payment_terms:'net30',_oi:1,_it:2100,_ac:2100,_a3:0,_a6:0,_a9:0},
{id:'v4',name:'S&S Activewear',vendor_type:'api',api_provider:'ss_activewear',nsa_carries_inventory:false,is_active:true,contact_email:'service@ssactivewear.com',payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v5',name:'Richardson',vendor_type:'api',api_provider:'richardson',nsa_carries_inventory:false,is_active:true,contact_email:'orders@richardsonsports.com',payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v6',name:'Rawlings',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v7',name:'Badger',vendor_type:'upload',nsa_carries_inventory:false,is_active:true,payment_terms:'net30',_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
{id:'v8',name:'Momentec',vendor_type:'api',api_provider:'momentec',nsa_carries_inventory:false,is_active:true,contact_email:'orders@momentecbrands.com',payment_terms:'net30',api_price_discount:0.15,_oi:0,_it:0,_ac:0,_a3:0,_a6:0,_a9:0},
];
export const D_P=[];
export const D_E=[];
export const D_SO=[];
export const D_MSG=[];
export const D_INV=[];

// OMG TEAM STORES
export const D_OMG=[];
