// How people appear in the site WhatsApp group export, mapped to staff ids.
export const GROUP_ALIASES: Record<string, string> = {
  "Ravi HK Sup": "sup_hk",
  "Anil Security": "sup_sec",
  "Manjunath Tech": "sup_tech",
  "Suresh STP": "stp_op1",
  "Imran STP": "stp_op2",
  "Venkatesh Garden": "sup_land",
  "Priya FM": "fm",
  "Secretary LG": "client_sec",
  "Raghu Night Sup": "sec_sup3",
  "Kavitha Committee": "committee",
};

export const aliasFor = (staffId: string) => Object.entries(GROUP_ALIASES).find(([, id]) => id === staffId)?.[0] ?? staffId;
