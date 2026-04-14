const admin = require("firebase-admin");

admin.initializeApp({

  credential: admin.credential.cert({
    "type": "service_account",
    "project_id": "estimation-12-979f3",
    "private_key_id": "9802j",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC8q+nhNm8SFjRm\n9qRlmlsRyQ70G2hmUl7jz2nUDLVpHkJeTksY2G7FfkHE08hMZATN7ezokHnXu2Mr\ndEUapmk1vUVuzad31gT0fMyBzb9yjHJ/EC4tKAUvhIrOJzb8xQKcXi73MPSEB4ZL\nSPlMXc5ErKFkmgJC4kciWW0AFWlsd76FNvtnc15bgiyBs/axwU5hu21nlpFbwzrY\ngw35w4nncbDJY7b3OZGzZcGZHcJZu1xsM7Q/u+6rkNeyzLjJUJZ36RfRhqOb2Huw\nIIKjhQbjGFdnfMjuFn5FWUtiHwNof/2umYCkRaxC6nr779wGp0eFppv5gfukztVA\ng209/10zAgMBAAECggEAEF5cQlhZPVkR0mQ2XqsMMmtrUbOJbjJaEZE7UQgjoQTc\n1/1Nt9BNlyX21l9Tv4gZ5psF9Izve5wofjehjmG+1Pu6KPyZbLGNT0zLs7zbwQT9\nIsr1LQb0B2uMKb1U0785evZGd6NJ3QtUelzQmPCDTO/3nJiQw6hWaMN+mNHcVwP/\nI/Aci45x/ah0KVG3AXjuv1IdRofwJeEbWRpArIocmLmV9Av/NAEzIAZAls5xZD7m\nydf8F6axDJYk8FEcVHed9sYFDoPOVszkR+d1i9IzlQImcnCpMhNVcLoviTpg0IXV\nT8W+VHMg7b1B+QHXnjZ0SpwEDIdBvEdIM8fIYmYluQKBgQDRDycDskzQu/KepGyc\nTenihG9XRXQTicc+IpW7zwzN7vCJUxQ0b3BviuoMzPzXxKbYils2OUhWvd6m5E7g\nzM9Gl0pxW/DOK+YeZrPpWoylUgQW8jTGDnZRreqAO6ak/YmmL0XZyGCVldHA/g2j\npBMNvrSPtpCpwm1tRdKfF/SRJwKBgQDnCN3jPtX2OnqXA7nmDnEf+lOBtCX9pyL3\n1F9ecyr0SSBGqaG2mLuVkE+ExYtogwDNSuOP6pK4BwSiP1j+W2/i2wvjHoOh5ur+\np5UAXpD6U0EsuEglCnuuYFJab3oIZgjRejNUIaBIf0V1MQNEXjxC4NIa3GYzUMwz\nVXg4WmQDFQKBgCRibLnZ+ECD1XAC0dxKOyBvSCl6Lv+PhRutTT4IhQP6R+a+jM+r\nbXgcRyu/KWosEZWyTrmbMpnWJcAKEChTvOdeQViFVd2sCjrUSQ+d8Mh9A7Uypjiq\nH7GLgTqcJx6j+abwp0mF9DlUf9ME5D7MuXw06pvwfDDvY7gW5NdHhgsVAoGAdPto\nXshSTnsN16lrV7G4VhjKb8Jn+ifG7PX71Dc8aLUeQqlh2LM9SF3p5bChBipPHaPt\n1dFQuR3UmtK4nRJvdM61Fis9O51RH+B68dTwU9AUEDC/VwIX3hOnn2MSx23iyS63\nDsJ4Bj1rTgujO9r7aGGuASvYE+O1gcilNuOOAIECgYAxVzxEU0Iedqye5mnkPDd1\n/ZqEFA7AllEXSmsleLYacKnmAxhY5e6xicvhyfvzGbhXfzyz+J73kqnFU2P+ppbS\nHziA8O/k9sagTxEDWmUF1TabUR/DHkP9HU/mv/+MH6N5iaUHivmHWBVeXGGYIvLq\n7rT4gCdO93Vusn6DpsKUvg==\n-----END PRIVATE KEY-----\n",
    "client_email": "firebase-admins99wsdk-g9ka6@estimation-kingdom-979f3.iam.gserviceaccount.com",
    "client_id": "113551823640591719285",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-g9ka6%40estimation-kingdom-979f3.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
  })
});
