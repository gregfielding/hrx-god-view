export interface Industry {
  code: string;
  name: string;
  category: string;
  description?: string;
  naicsCode?: string;
  sicCode?: string;
}

export const INDUSTRIES: Industry[] = [
  // Agriculture, Forestry, Fishing and Hunting
  {
    code: '11',
    name: 'Agriculture, Forestry, Fishing and Hunting',
    category: 'Primary Industries',
  },
  { code: '111', name: 'Crop Production', category: 'Agriculture' },
  { code: '112', name: 'Animal Production and Aquaculture', category: 'Agriculture' },
  { code: '113', name: 'Forestry and Logging', category: 'Agriculture' },
  { code: '114', name: 'Fishing, Hunting and Trapping', category: 'Agriculture' },
  { code: '115', name: 'Support Activities for Agriculture and Forestry', category: 'Agriculture' },

  // Mining, Quarrying, and Oil and Gas Extraction
  {
    code: '21',
    name: 'Mining, Quarrying, and Oil and Gas Extraction',
    category: 'Primary Industries',
  },
  { code: '211', name: 'Oil and Gas Extraction', category: 'Mining' },
  { code: '212', name: 'Mining (except Oil and Gas)', category: 'Mining' },
  { code: '213', name: 'Support Activities for Mining', category: 'Mining' },

  // Utilities
  { code: '22', name: 'Utilities', category: 'Infrastructure' },
  { code: '221', name: 'Utilities', category: 'Infrastructure' },

  // Construction
  { code: '23', name: 'Construction', category: 'Construction' },
  { code: '236', name: 'Construction of Buildings', category: 'Construction' },
  { code: '237', name: 'Heavy and Civil Engineering Construction', category: 'Construction' },
  { code: '238', name: 'Specialty Trade Contractors', category: 'Construction' },

  // Manufacturing
  { code: '31', name: 'Manufacturing', category: 'Manufacturing' },
  { code: '311', name: 'Food Manufacturing', category: 'Manufacturing' },
  { code: '312', name: 'Beverage and Tobacco Product Manufacturing', category: 'Manufacturing' },
  { code: '313', name: 'Textile Mills', category: 'Manufacturing' },
  { code: '314', name: 'Textile Product Mills', category: 'Manufacturing' },
  { code: '315', name: 'Apparel Manufacturing', category: 'Manufacturing' },
  { code: '316', name: 'Leather and Allied Product Manufacturing', category: 'Manufacturing' },
  { code: '321', name: 'Wood Product Manufacturing', category: 'Manufacturing' },
  { code: '322', name: 'Paper Manufacturing', category: 'Manufacturing' },
  { code: '323', name: 'Printing and Related Support Activities', category: 'Manufacturing' },
  { code: '324', name: 'Petroleum and Coal Products Manufacturing', category: 'Manufacturing' },
  { code: '325', name: 'Chemical Manufacturing', category: 'Manufacturing' },
  { code: '326', name: 'Plastics and Rubber Products Manufacturing', category: 'Manufacturing' },
  { code: '327', name: 'Nonmetallic Mineral Product Manufacturing', category: 'Manufacturing' },
  { code: '331', name: 'Primary Metal Manufacturing', category: 'Manufacturing' },
  { code: '332', name: 'Fabricated Metal Product Manufacturing', category: 'Manufacturing' },
  { code: '333', name: 'Machinery Manufacturing', category: 'Manufacturing' },
  { code: '334', name: 'Computer and Electronic Product Manufacturing', category: 'Manufacturing' },
  {
    code: '335',
    name: 'Electrical Equipment, Appliance, and Component Manufacturing',
    category: 'Manufacturing',
  },
  { code: '336', name: 'Transportation Equipment Manufacturing', category: 'Manufacturing' },
  { code: '337', name: 'Furniture and Related Product Manufacturing', category: 'Manufacturing' },
  { code: '339', name: 'Miscellaneous Manufacturing', category: 'Manufacturing' },

  // Wholesale Trade
  { code: '42', name: 'Wholesale Trade', category: 'Trade' },
  { code: '423', name: 'Merchant Wholesalers, Durable Goods', category: 'Wholesale Trade' },
  { code: '424', name: 'Merchant Wholesalers, Nondurable Goods', category: 'Wholesale Trade' },
  {
    code: '425',
    name: 'Wholesale Electronic Markets and Agents and Brokers',
    category: 'Wholesale Trade',
  },

  // Retail Trade
  { code: '44', name: 'Retail Trade', category: 'Trade' },
  { code: '441', name: 'Motor Vehicle and Parts Dealers', category: 'Retail Trade' },
  { code: '442', name: 'Furniture and Home Furnishings Stores', category: 'Retail Trade' },
  { code: '443', name: 'Electronics and Appliance Stores', category: 'Retail Trade' },
  {
    code: '444',
    name: 'Building Material and Garden Equipment and Supplies Dealers',
    category: 'Retail Trade',
  },
  { code: '445', name: 'Food and Beverage Stores', category: 'Retail Trade' },
  { code: '446', name: 'Health and Personal Care Stores', category: 'Retail Trade' },
  { code: '447', name: 'Gasoline Stations', category: 'Retail Trade' },
  { code: '448', name: 'Clothing and Clothing Accessories Stores', category: 'Retail Trade' },
  {
    code: '451',
    name: 'Sporting Goods, Hobby, Musical Instrument, and Book Stores',
    category: 'Retail Trade',
  },
  { code: '452', name: 'General Merchandise Stores', category: 'Retail Trade' },
  { code: '453', name: 'Miscellaneous Store Retailers', category: 'Retail Trade' },
  { code: '454', name: 'Nonstore Retailers', category: 'Retail Trade' },

  // Transportation and Warehousing
  { code: '48', name: 'Transportation and Warehousing', category: 'Transportation' },
  { code: '481', name: 'Air Transportation', category: 'Transportation' },
  { code: '482', name: 'Rail Transportation', category: 'Transportation' },
  { code: '483', name: 'Water Transportation', category: 'Transportation' },
  { code: '484', name: 'Truck Transportation', category: 'Transportation' },
  { code: '485', name: 'Transit and Ground Passenger Transportation', category: 'Transportation' },
  { code: '486', name: 'Pipeline Transportation', category: 'Transportation' },
  { code: '487', name: 'Scenic and Sightseeing Transportation', category: 'Transportation' },
  { code: '488', name: 'Support Activities for Transportation', category: 'Transportation' },
  { code: '492', name: 'Couriers and Messengers', category: 'Transportation' },
  { code: '493', name: 'Warehousing and Storage', category: 'Transportation' },

  // Information
  { code: '51', name: 'Information', category: 'Technology' },
  { code: '511', name: 'Publishing Industries', category: 'Information' },
  { code: '512', name: 'Motion Picture and Sound Recording Industries', category: 'Information' },
  { code: '515', name: 'Broadcasting (except Internet)', category: 'Information' },
  { code: '517', name: 'Telecommunications', category: 'Information' },
  { code: '518', name: 'Data Processing, Hosting, and Related Services', category: 'Information' },
  { code: '519', name: 'Other Information Services', category: 'Information' },

  // Finance and Insurance
  { code: '52', name: 'Finance and Insurance', category: 'Financial Services' },
  { code: '521', name: 'Monetary Authorities-Central Bank', category: 'Finance' },
  { code: '522', name: 'Credit Intermediation and Related Activities', category: 'Finance' },
  {
    code: '523',
    name: 'Securities, Commodity Contracts, and Other Financial Investments and Related Activities',
    category: 'Finance',
  },
  { code: '524', name: 'Insurance Carriers and Related Activities', category: 'Insurance' },
  { code: '525', name: 'Funds, Trusts, and Other Financial Vehicles', category: 'Finance' },

  // Real Estate and Rental and Leasing
  { code: '53', name: 'Real Estate and Rental and Leasing', category: 'Real Estate' },
  { code: '531', name: 'Real Estate', category: 'Real Estate' },
  { code: '532', name: 'Rental and Leasing Services', category: 'Real Estate' },
  {
    code: '533',
    name: 'Lessors of Nonfinancial Intangible Assets (except Copyrighted Works)',
    category: 'Real Estate',
  },

  // Professional, Scientific, and Technical Services
  {
    code: '54',
    name: 'Professional, Scientific, and Technical Services',
    category: 'Professional Services',
  },
  {
    code: '541',
    name: 'Professional, Scientific, and Technical Services',
    category: 'Professional Services',
  },

  // Management of Companies and Enterprises
  { code: '55', name: 'Management of Companies and Enterprises', category: 'Management' },
  { code: '551', name: 'Management of Companies and Enterprises', category: 'Management' },

  // Administrative and Support and Waste Management and Remediation Services
  {
    code: '56',
    name: 'Administrative and Support and Waste Management and Remediation Services',
    category: 'Administrative Services',
  },
  { code: '561', name: 'Administrative and Support Services', category: 'Administrative Services' },
  {
    code: '562',
    name: 'Waste Management and Remediation Services',
    category: 'Administrative Services',
  },

  // Educational Services
  { code: '61', name: 'Educational Services', category: 'Education' },
  { code: '611', name: 'Educational Services', category: 'Education' },

  // Health Care and Social Assistance
  { code: '62', name: 'Health Care and Social Assistance', category: 'Healthcare' },
  { code: '621', name: 'Ambulatory Health Care Services', category: 'Healthcare' },
  { code: '622', name: 'Hospitals', category: 'Healthcare' },
  { code: '623', name: 'Nursing and Residential Care Facilities', category: 'Healthcare' },
  { code: '624', name: 'Social Assistance', category: 'Healthcare' },

  // Arts, Entertainment, and Recreation
  { code: '71', name: 'Arts, Entertainment, and Recreation', category: 'Entertainment' },
  {
    code: '711',
    name: 'Performing Arts, Spectator Sports, and Related Industries',
    category: 'Entertainment',
  },
  {
    code: '712',
    name: 'Museums, Historical Sites, and Similar Institutions',
    category: 'Entertainment',
  },
  {
    code: '713',
    name: 'Amusement, Gambling, and Recreation Industries',
    category: 'Entertainment',
  },

  // Accommodation and Food Services
  { code: '72', name: 'Accommodation and Food Services', category: 'Hospitality' },
  { code: '721', name: 'Accommodation', category: 'Hospitality' },
  { code: '722', name: 'Food Services and Drinking Places', category: 'Hospitality' },

  // Other Services (except Public Administration)
  { code: '81', name: 'Other Services (except Public Administration)', category: 'Other Services' },
  { code: '811', name: 'Repair and Maintenance', category: 'Other Services' },
  { code: '812', name: 'Personal and Laundry Services', category: 'Other Services' },
  {
    code: '813',
    name: 'Religious, Grantmaking, Civic, Professional, and Similar Organizations',
    category: 'Other Services',
  },
  { code: '814', name: 'Private Households', category: 'Other Services' },

  // Public Administration
  { code: '92', name: 'Public Administration', category: 'Government' },
  {
    code: '921',
    name: 'Executive, Legislative, and Other General Government Support',
    category: 'Government',
  },
  { code: '922', name: 'Justice, Public Order, and Safety Activities', category: 'Government' },
  { code: '923', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '924', name: 'Administration of Environmental Quality Programs', category: 'Government' },
  {
    code: '925',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  { code: '926', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '927', name: 'Space Research and Technology', category: 'Government' },
  { code: '928', name: 'National Security and International Affairs', category: 'Government' },

  // Temporary Staffing and Professional Services
  { code: '5613', name: 'Employment Services', category: 'Staffing' },
  { code: '56132', name: 'Temporary Help Services', category: 'Staffing' },
  { code: '56133', name: 'Professional Employer Organizations', category: 'Staffing' },
  { code: '56134', name: 'Employee Leasing Services', category: 'Staffing' },

  // Technology and Software
  { code: '5112', name: 'Software Publishers', category: 'Technology' },
  { code: '5182', name: 'Data Processing, Hosting, and Related Services', category: 'Technology' },
  { code: '5415', name: 'Computer Systems Design and Related Services', category: 'Technology' },
  {
    code: '5416',
    name: 'Management, Scientific, and Technical Consulting Services',
    category: 'Technology',
  },
  { code: '5417', name: 'Scientific Research and Development Services', category: 'Technology' },
  {
    code: '5418',
    name: 'Advertising, Public Relations, and Related Services',
    category: 'Technology',
  },
  {
    code: '5419',
    name: 'Other Professional, Scientific, and Technical Services',
    category: 'Technology',
  },

  // Healthcare Specific
  { code: '6211', name: 'Offices of Physicians', category: 'Healthcare' },
  { code: '6212', name: 'Offices of Dentists', category: 'Healthcare' },
  { code: '6213', name: 'Offices of Other Health Practitioners', category: 'Healthcare' },
  { code: '6214', name: 'Outpatient Care Centers', category: 'Healthcare' },
  { code: '6215', name: 'Medical and Diagnostic Laboratories', category: 'Healthcare' },
  { code: '6216', name: 'Home Health Care Services', category: 'Healthcare' },
  { code: '6219', name: 'Other Ambulatory Health Care Services', category: 'Healthcare' },
  { code: '6221', name: 'General Medical and Surgical Hospitals', category: 'Healthcare' },
  { code: '6222', name: 'Psychiatric and Substance Abuse Hospitals', category: 'Healthcare' },
  {
    code: '6223',
    name: 'Specialty (except Psychiatric and Substance Abuse) Hospitals',
    category: 'Healthcare',
  },
  {
    code: '6231',
    name: 'Nursing Care Facilities (Skilled Nursing Facilities)',
    category: 'Healthcare',
  },
  {
    code: '6232',
    name: 'Residential Intellectual and Developmental Disability, Mental Health, and Substance Abuse Facilities',
    category: 'Healthcare',
  },
  {
    code: '6233',
    name: 'Continuing Care Retirement Communities and Assisted Living Facilities for the Elderly',
    category: 'Healthcare',
  },
  { code: '6239', name: 'Other Residential Care Facilities', category: 'Healthcare' },
  { code: '6241', name: 'Individual and Family Services', category: 'Healthcare' },
  {
    code: '6242',
    name: 'Community Food and Housing, and Emergency and Other Relief Services',
    category: 'Healthcare',
  },
  { code: '6243', name: 'Vocational Rehabilitation Services', category: 'Healthcare' },
  { code: '6244', name: 'Child Day Care Services', category: 'Healthcare' },

  // Manufacturing Specific
  {
    code: '3323',
    name: 'Architectural and Structural Metals Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3324',
    name: 'Boiler, Tank, and Shipping Container Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3325', name: 'Hardware Manufacturing', category: 'Manufacturing' },
  { code: '3326', name: 'Spring and Wire Product Manufacturing', category: 'Manufacturing' },
  {
    code: '3327',
    name: 'Machine Shops; Turned Product; and Screw, Nut, and Bolt Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3328',
    name: 'Coating, Engraving, Heat Treating, and Allied Activities',
    category: 'Manufacturing',
  },
  { code: '3329', name: 'Other Fabricated Metal Product Manufacturing', category: 'Manufacturing' },
  {
    code: '3331',
    name: 'Agriculture, Construction, and Mining Machinery Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3332', name: 'Industrial Machinery Manufacturing', category: 'Manufacturing' },
  {
    code: '3333',
    name: 'Commercial and Service Industry Machinery Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3334',
    name: 'Ventilation, Heating, Air-Conditioning, and Commercial Refrigeration Equipment Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3335', name: 'Metalworking Machinery Manufacturing', category: 'Manufacturing' },
  {
    code: '3336',
    name: 'Engine, Turbine, and Power Transmission Equipment Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3339',
    name: 'Other General Purpose Machinery Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3341',
    name: 'Computer and Peripheral Equipment Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3342', name: 'Communications Equipment Manufacturing', category: 'Manufacturing' },
  { code: '3343', name: 'Audio and Video Equipment Manufacturing', category: 'Manufacturing' },
  {
    code: '3344',
    name: 'Semiconductor and Other Electronic Component Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3345',
    name: 'Navigational, Measuring, Electromedical, and Control Instruments Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3346',
    name: 'Manufacturing and Reproducing Magnetic and Optical Media',
    category: 'Manufacturing',
  },
  { code: '3351', name: 'Electric Lighting Equipment Manufacturing', category: 'Manufacturing' },
  { code: '3352', name: 'Household Appliance Manufacturing', category: 'Manufacturing' },
  { code: '3353', name: 'Electrical Equipment Manufacturing', category: 'Manufacturing' },
  {
    code: '3359',
    name: 'Other Electrical Equipment and Component Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3361', name: 'Motor Vehicle Manufacturing', category: 'Manufacturing' },
  { code: '3362', name: 'Motor Vehicle Body and Trailer Manufacturing', category: 'Manufacturing' },
  { code: '3363', name: 'Motor Vehicle Parts Manufacturing', category: 'Manufacturing' },
  { code: '3364', name: 'Aerospace Product and Parts Manufacturing', category: 'Manufacturing' },
  { code: '3365', name: 'Railroad Rolling Stock Manufacturing', category: 'Manufacturing' },
  { code: '3366', name: 'Ship and Boat Building', category: 'Manufacturing' },
  { code: '3369', name: 'Other Transportation Equipment Manufacturing', category: 'Manufacturing' },
  {
    code: '3371',
    name: 'Household and Institutional Furniture and Kitchen Cabinet Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3372',
    name: 'Office Furniture (including Fixtures) Manufacturing',
    category: 'Manufacturing',
  },
  {
    code: '3379',
    name: 'Other Furniture Related Product Manufacturing',
    category: 'Manufacturing',
  },
  { code: '3391', name: 'Medical Equipment and Supplies Manufacturing', category: 'Manufacturing' },
  { code: '3399', name: 'Other Miscellaneous Manufacturing', category: 'Manufacturing' },

  // Construction Specific
  { code: '2361', name: 'Residential Building Construction', category: 'Construction' },
  { code: '2362', name: 'Nonresidential Building Construction', category: 'Construction' },
  { code: '2371', name: 'Utility System Construction', category: 'Construction' },
  { code: '2372', name: 'Land Subdivision', category: 'Construction' },
  { code: '2373', name: 'Highway, Street, and Bridge Construction', category: 'Construction' },
  {
    code: '2379',
    name: 'Other Heavy and Civil Engineering Construction',
    category: 'Construction',
  },
  {
    code: '2381',
    name: 'Foundation, Structure, and Building Exterior Contractors',
    category: 'Construction',
  },
  { code: '2382', name: 'Building Equipment Contractors', category: 'Construction' },
  { code: '2383', name: 'Building Finishing Contractors', category: 'Construction' },
  { code: '2389', name: 'Other Specialty Trade Contractors', category: 'Construction' },

  // Retail Specific
  { code: '4411', name: 'Automobile Dealers', category: 'Retail Trade' },
  { code: '4412', name: 'Other Motor Vehicle Dealers', category: 'Retail Trade' },
  {
    code: '4413',
    name: 'Automotive Parts, Accessories, and Tire Stores',
    category: 'Retail Trade',
  },
  { code: '4421', name: 'Furniture Stores', category: 'Retail Trade' },
  { code: '4422', name: 'Home Furnishings Stores', category: 'Retail Trade' },
  { code: '4431', name: 'Electronics and Appliance Stores', category: 'Retail Trade' },
  { code: '4441', name: 'Building Material and Supplies Dealers', category: 'Retail Trade' },
  { code: '4442', name: 'Lawn and Garden Equipment and Supplies Stores', category: 'Retail Trade' },
  { code: '4451', name: 'Grocery Stores', category: 'Retail Trade' },
  { code: '4452', name: 'Specialty Food Stores', category: 'Retail Trade' },
  { code: '4453', name: 'Beer, Wine, and Liquor Stores', category: 'Retail Trade' },
  { code: '4461', name: 'Health and Personal Care Stores', category: 'Retail Trade' },
  { code: '4471', name: 'Gasoline Stations', category: 'Retail Trade' },
  { code: '4481', name: 'Clothing Stores', category: 'Retail Trade' },
  { code: '4482', name: 'Shoe Stores', category: 'Retail Trade' },
  { code: '4483', name: 'Jewelry, Luggage, and Leather Goods Stores', category: 'Retail Trade' },
  {
    code: '4511',
    name: 'Sporting Goods, Hobby, and Musical Instrument Stores',
    category: 'Retail Trade',
  },
  { code: '4512', name: 'Book Stores and News Dealers', category: 'Retail Trade' },
  { code: '4521', name: 'Department Stores', category: 'Retail Trade' },
  { code: '4522', name: 'Warehouse Clubs and Supercenters', category: 'Retail Trade' },
  {
    code: '4523',
    name: 'General Merchandise Stores, including Warehouse Clubs and Supercenters',
    category: 'Retail Trade',
  },
  { code: '4531', name: 'Florists', category: 'Retail Trade' },
  { code: '4532', name: 'Office Supplies, Stationery, and Gift Stores', category: 'Retail Trade' },
  { code: '4533', name: 'Used Merchandise Stores', category: 'Retail Trade' },
  { code: '4539', name: 'Other Miscellaneous Store Retailers', category: 'Retail Trade' },
  { code: '4541', name: 'Electronic Shopping and Mail-Order Houses', category: 'Retail Trade' },
  { code: '4542', name: 'Vending Machine Operators', category: 'Retail Trade' },
  { code: '4543', name: 'Direct Selling Establishments', category: 'Retail Trade' },

  // Transportation Specific
  { code: '4811', name: 'Scheduled Air Transportation', category: 'Transportation' },
  { code: '4812', name: 'Nonscheduled Air Transportation', category: 'Transportation' },
  { code: '4821', name: 'Rail Transportation', category: 'Transportation' },
  {
    code: '4831',
    name: 'Deep Sea, Coastal, and Great Lakes Water Transportation',
    category: 'Transportation',
  },
  { code: '4832', name: 'Inland Water Transportation', category: 'Transportation' },
  { code: '4841', name: 'General Freight Trucking', category: 'Transportation' },
  { code: '4842', name: 'Specialized Freight Trucking', category: 'Transportation' },
  { code: '4851', name: 'Urban Transit Systems', category: 'Transportation' },
  { code: '4852', name: 'Interurban and Rural Bus Transportation', category: 'Transportation' },
  { code: '4853', name: 'Taxi and Limousine Service', category: 'Transportation' },
  { code: '4854', name: 'School and Employee Bus Transportation', category: 'Transportation' },
  { code: '4855', name: 'Charter Bus Industry', category: 'Transportation' },
  {
    code: '4859',
    name: 'Other Transit and Ground Passenger Transportation',
    category: 'Transportation',
  },
  { code: '4861', name: 'Pipeline Transportation of Crude Oil', category: 'Transportation' },
  { code: '4862', name: 'Pipeline Transportation of Natural Gas', category: 'Transportation' },
  { code: '4869', name: 'Other Pipeline Transportation', category: 'Transportation' },
  { code: '4871', name: 'Scenic and Sightseeing Transportation, Land', category: 'Transportation' },
  {
    code: '4872',
    name: 'Scenic and Sightseeing Transportation, Water',
    category: 'Transportation',
  },
  {
    code: '4879',
    name: 'Scenic and Sightseeing Transportation, Other',
    category: 'Transportation',
  },
  { code: '4881', name: 'Support Activities for Air Transportation', category: 'Transportation' },
  { code: '4882', name: 'Support Activities for Rail Transportation', category: 'Transportation' },
  { code: '4883', name: 'Support Activities for Water Transportation', category: 'Transportation' },
  { code: '4884', name: 'Support Activities for Road Transportation', category: 'Transportation' },
  { code: '4885', name: 'Freight Transportation Arrangement', category: 'Transportation' },
  { code: '4889', name: 'Other Support Activities for Transportation', category: 'Transportation' },
  { code: '4921', name: 'Couriers and Express Delivery Services', category: 'Transportation' },
  { code: '4922', name: 'Local Messengers and Local Delivery', category: 'Transportation' },
  { code: '4931', name: 'Warehousing and Storage', category: 'Transportation' },

  // Finance and Insurance Specific
  { code: '5221', name: 'Depository Credit Intermediation', category: 'Finance' },
  { code: '5222', name: 'Nondepository Credit Intermediation', category: 'Finance' },
  { code: '5223', name: 'Activities Related to Credit Intermediation', category: 'Finance' },
  {
    code: '5231',
    name: 'Securities and Commodity Contracts Intermediation and Brokerage',
    category: 'Finance',
  },
  { code: '5232', name: 'Securities and Commodity Exchanges', category: 'Finance' },
  { code: '5239', name: 'Other Financial Investment Activities', category: 'Finance' },
  { code: '5241', name: 'Insurance Carriers', category: 'Insurance' },
  {
    code: '5242',
    name: 'Agencies, Brokerages, and Other Insurance Related Activities',
    category: 'Insurance',
  },
  { code: '5251', name: 'Insurance and Employee Benefit Funds', category: 'Finance' },
  { code: '5259', name: 'Other Investment Pools and Funds', category: 'Finance' },

  // Real Estate Specific
  { code: '5311', name: 'Lessors of Real Estate', category: 'Real Estate' },
  { code: '5312', name: 'Offices of Real Estate Agents and Brokers', category: 'Real Estate' },
  { code: '5313', name: 'Activities Related to Real Estate', category: 'Real Estate' },
  { code: '5321', name: 'Automotive Equipment Rental and Leasing', category: 'Real Estate' },
  { code: '5322', name: 'Consumer Goods Rental', category: 'Real Estate' },
  { code: '5323', name: 'General Rental Centers', category: 'Real Estate' },
  {
    code: '5324',
    name: 'Commercial and Industrial Machinery and Equipment Rental and Leasing',
    category: 'Real Estate',
  },
  {
    code: '5331',
    name: 'Lessors of Nonfinancial Intangible Assets (except Copyrighted Works)',
    category: 'Real Estate',
  },

  // Professional Services Specific
  { code: '5411', name: 'Legal Services', category: 'Professional Services' },
  {
    code: '5412',
    name: 'Accounting, Tax Preparation, Bookkeeping, and Payroll Services',
    category: 'Professional Services',
  },
  {
    code: '5413',
    name: 'Architectural, Engineering, and Related Services',
    category: 'Professional Services',
  },
  { code: '5414', name: 'Specialized Design Services', category: 'Professional Services' },
  {
    code: '5415',
    name: 'Computer Systems Design and Related Services',
    category: 'Professional Services',
  },
  {
    code: '5416',
    name: 'Management, Scientific, and Technical Consulting Services',
    category: 'Professional Services',
  },
  {
    code: '5417',
    name: 'Scientific Research and Development Services',
    category: 'Professional Services',
  },
  {
    code: '5418',
    name: 'Advertising, Public Relations, and Related Services',
    category: 'Professional Services',
  },
  {
    code: '5419',
    name: 'Other Professional, Scientific, and Technical Services',
    category: 'Professional Services',
  },

  // Administrative Services Specific
  { code: '5611', name: 'Office Administrative Services', category: 'Administrative Services' },
  { code: '5612', name: 'Facilities Support Services', category: 'Administrative Services' },
  { code: '5613', name: 'Employment Services', category: 'Administrative Services' },
  { code: '5614', name: 'Business Support Services', category: 'Administrative Services' },
  {
    code: '5615',
    name: 'Travel Arrangement and Reservation Services',
    category: 'Administrative Services',
  },
  {
    code: '5616',
    name: 'Investigation and Security Services',
    category: 'Administrative Services',
  },
  {
    code: '5617',
    name: 'Services to Buildings and Dwellings',
    category: 'Administrative Services',
  },
  { code: '5619', name: 'Other Support Services', category: 'Administrative Services' },
  { code: '5621', name: 'Waste Collection', category: 'Administrative Services' },
  { code: '5622', name: 'Waste Treatment and Disposal', category: 'Administrative Services' },
  {
    code: '5629',
    name: 'Remediation and Other Waste Management Services',
    category: 'Administrative Services',
  },

  // Education Specific
  { code: '6111', name: 'Elementary and Secondary Schools', category: 'Education' },
  { code: '6112', name: 'Junior Colleges', category: 'Education' },
  { code: '6113', name: 'Colleges, Universities, and Professional Schools', category: 'Education' },
  {
    code: '6114',
    name: 'Business Schools and Computer and Management Training',
    category: 'Education',
  },
  { code: '6115', name: 'Technical and Trade Schools', category: 'Education' },
  { code: '6116', name: 'Other Schools and Instruction', category: 'Education' },
  { code: '6117', name: 'Educational Support Services', category: 'Education' },

  // Arts, Entertainment, and Recreation Specific
  { code: '7111', name: 'Performing Arts Companies', category: 'Entertainment' },
  { code: '7112', name: 'Spectator Sports', category: 'Entertainment' },
  {
    code: '7113',
    name: 'Promoters of Performing Arts, Sports, and Similar Events',
    category: 'Entertainment',
  },
  {
    code: '7114',
    name: 'Agents and Managers for Artists, Athletes, Entertainers, and Other Public Figures',
    category: 'Entertainment',
  },
  { code: '7115', name: 'Independent Artists, Writers, and Performers', category: 'Entertainment' },
  {
    code: '7121',
    name: 'Museums, Historical Sites, and Similar Institutions',
    category: 'Entertainment',
  },
  { code: '7131', name: 'Amusement Parks and Arcades', category: 'Entertainment' },
  { code: '7132', name: 'Gambling Industries', category: 'Entertainment' },
  { code: '7139', name: 'Other Amusement and Recreation Industries', category: 'Entertainment' },

  // Accommodation and Food Services Specific
  { code: '7211', name: 'Traveler Accommodation', category: 'Hospitality' },
  {
    code: '7212',
    name: 'RV (Recreational Vehicle) Parks and Recreational Camps',
    category: 'Hospitality',
  },
  { code: '7213', name: 'Rooming and Boarding Houses', category: 'Hospitality' },
  { code: '7223', name: 'Special Food Services', category: 'Hospitality' },
  { code: '7224', name: 'Drinking Places (Alcoholic Beverages)', category: 'Hospitality' },
  { code: '7225', name: 'Restaurants and Other Eating Places', category: 'Hospitality' },

  // Other Services Specific
  { code: '8111', name: 'Automotive Repair and Maintenance', category: 'Other Services' },
  {
    code: '8112',
    name: 'Electronic and Precision Equipment Repair and Maintenance',
    category: 'Other Services',
  },
  {
    code: '8113',
    name: 'Commercial and Industrial Machinery and Equipment (except Automotive and Electronic) Repair and Maintenance',
    category: 'Other Services',
  },
  {
    code: '8114',
    name: 'Personal and Household Goods Repair and Maintenance',
    category: 'Other Services',
  },
  { code: '8121', name: 'Personal Care Services', category: 'Other Services' },
  { code: '8122', name: 'Death Care Services', category: 'Other Services' },
  { code: '8123', name: 'Drycleaning and Laundry Services', category: 'Other Services' },
  { code: '8129', name: 'Other Personal Services', category: 'Other Services' },
  { code: '8131', name: 'Religious Organizations', category: 'Other Services' },
  { code: '8132', name: 'Grantmaking and Giving Services', category: 'Other Services' },
  { code: '8133', name: 'Social Advocacy Organizations', category: 'Other Services' },
  { code: '8134', name: 'Civic and Social Organizations', category: 'Other Services' },
  {
    code: '8139',
    name: 'Business, Professional, Labor, Political, and Similar Organizations',
    category: 'Other Services',
  },
  { code: '8141', name: 'Private Households', category: 'Other Services' },

  // Public Administration Specific
  { code: '9211', name: 'Executive Offices', category: 'Government' },
  { code: '9212', name: 'Legislative Bodies', category: 'Government' },
  { code: '9213', name: 'Public Finance Activities', category: 'Government' },
  { code: '9214', name: 'Executive and Legislative Offices, Combined', category: 'Government' },
  {
    code: '9215',
    name: 'American Indian and Alaska Native Tribal Governments',
    category: 'Government',
  },
  { code: '9219', name: 'Other General Government Support', category: 'Government' },
  { code: '9221', name: 'Justice, Public Order, and Safety Activities', category: 'Government' },
  { code: '9222', name: 'Public Order and Safety', category: 'Government' },
  { code: '9223', name: 'Justice, Public Order, and Safety Activities', category: 'Government' },
  { code: '9231', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9232', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9233', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9234', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9235', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9236', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9237', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9238', name: 'Administration of Human Resource Programs', category: 'Government' },
  { code: '9239', name: 'Administration of Human Resource Programs', category: 'Government' },
  {
    code: '9241',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9242',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9243',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9244',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9245',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9246',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9247',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9248',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9249',
    name: 'Administration of Environmental Quality Programs',
    category: 'Government',
  },
  {
    code: '9251',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9252',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9253',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9254',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9255',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9256',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9257',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9258',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  {
    code: '9259',
    name: 'Administration of Housing Programs, Urban Planning, and Community Development',
    category: 'Government',
  },
  { code: '9261', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9262', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9263', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9264', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9265', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9266', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9267', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9268', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9269', name: 'Administration of Economic Programs', category: 'Government' },
  { code: '9271', name: 'Space Research and Technology', category: 'Government' },
  { code: '9272', name: 'Space Research and Technology', category: 'Government' },
  { code: '9273', name: 'Space Research and Technology', category: 'Government' },
  { code: '9274', name: 'Space Research and Technology', category: 'Government' },
  { code: '9275', name: 'Space Research and Technology', category: 'Government' },
  { code: '9276', name: 'Space Research and Technology', category: 'Government' },
  { code: '9277', name: 'Space Research and Technology', category: 'Government' },
  { code: '9278', name: 'Space Research and Technology', category: 'Government' },
  { code: '9279', name: 'Space Research and Technology', category: 'Government' },
  { code: '9281', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9282', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9283', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9284', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9285', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9286', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9287', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9288', name: 'National Security and International Affairs', category: 'Government' },
  { code: '9289', name: 'National Security and International Affairs', category: 'Government' },

  // Other/Unspecified
  { code: '9999', name: 'Other/Unspecified Industry', category: 'Other' },
];

export const getIndustryByCode = (code: string): Industry | undefined => {
  return INDUSTRIES.find((industry) => industry.code === code);
};

export const getIndustriesByCategory = (category: string): Industry[] => {
  return INDUSTRIES.filter((industry) => industry.category === category);
};

export const getIndustryCategories = (): string[] => {
  return [...new Set(INDUSTRIES.map((industry) => industry.category))];
};

export const searchIndustries = (query: string): Industry[] => {
  const lowerQuery = query.toLowerCase();
  return INDUSTRIES.filter(
    (industry) =>
      industry.name.toLowerCase().includes(lowerQuery) ||
      industry.code.includes(query) ||
      industry.category.toLowerCase().includes(lowerQuery),
  );
};
