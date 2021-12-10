import { AppStorage, LightningCustodianWallet, WatchOnlyWallet } from './';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import url from 'url';
import { Chain } from '../models/bitcoinUnits';
import Lnurl from './lnurl';
import Azteco from './azteco';
const bitcoin = require('bitcoinjs-lib');
const bip21 = require('bip21');

class DeeplinkSchemaMatch {
  static hasSchema(schemaString) {
    if (typeof schemaString !== 'string' || schemaString.length <= 0) return false;
    const lowercaseString = schemaString.trim().toLowerCase();
    return (
      lowercaseString.startsWith('bitflate:') ||
      lowercaseString.startsWith('bflwallet:')
    );
  }

  /**
   * Examines the content of the event parameter.
   * If the content is recognizable, create a dictionary with the respective
   * navigation dictionary required by react-navigation
   *
   * @param event {{url: string}} URL deeplink as passed to app, e.g. `bitflate:bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7?amount=666&label=Yo`
   * @param completionHandler {function} Callback that returns [string, params: object]
   */
  static navigationRouteFor(event, completionHandler, context = { wallets: [], saveToDisk: () => {}, addWallet: () => {} }) {
    if (event.url === null) {
      return;
    }
    if (typeof event.url !== 'string') {
      return;
    }

    if (event.url.toLowerCase().startsWith('bflwallet:bitflate:')) {
      event.url = event.url.substring(10);
    } else if (event.url.toLocaleLowerCase().startsWith('bflwallet://widget?action=')) {
      event.url = event.url.substring('bflwallet://'.length);
    }

    if (DeeplinkSchemaMatch.isWidgetAction(event.url)) {
      if (context.wallets.length >= 0) {
        const wallet = context.wallets[0];
        const action = event.url.split('widget?action=')[1];
        if (wallet.chain === Chain.ONCHAIN) {
          if (action === 'openSend') {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'SendDetails',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          } else if (action === 'openReceive') {
            completionHandler([
              'ReceiveDetailsRoot',
              {
                screen: 'ReceiveDetails',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          }
        } else if (wallet.chain === Chain.OFFCHAIN) {
          if (action === 'openSend') {
            completionHandler([
              'ScanLndInvoiceRoot',
              {
                screen: 'ScanLndInvoice',
                params: {
                  walletID: wallet.getID(),
                },
              },
            ]);
          } else if (action === 'openReceive') {
            completionHandler(['LNDCreateInvoiceRoot', { screen: 'LNDCreateInvoice', params: { walletID: wallet.getID() } }]);
          }
        }
      }
    } else if (DeeplinkSchemaMatch.isPossiblySignedPSBTFile(event.url)) {
      RNFS.readFile(decodeURI(event.url))
        .then(file => {
          if (file) {
            completionHandler([
              'SendDetailsRoot',
              {
                screen: 'PsbtWithHardwareWallet',
                params: {
                  deepLinkPSBT: file,
                },
              },
            ]);
          }
        })
        .catch(e => console.warn(e));
      return;
    }
    let isBothBitcoinAndLightning;
    try {
      isBothBitcoinAndLightning = DeeplinkSchemaMatch.isBothBitcoinAndLightning(event.url);
    } catch (e) {
      console.log(e);
    }
    if (isBothBitcoinAndLightning) {
      completionHandler([
        'SelectWallet',
        {
          onWalletSelect: (wallet, { navigation }) => {
            navigation.pop(); // close select wallet screen
            navigation.navigate(...DeeplinkSchemaMatch.isBothBitcoinAndLightningOnWalletSelect(wallet, isBothBitcoinAndLightning));
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isBitcoinAddress(event.url)) {
      completionHandler([
        'SendDetailsRoot',
        {
          screen: 'SendDetails',
          params: {
            uri: event.url,
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isLightningInvoice(event.url)) {
      completionHandler([
        'ScanLndInvoiceRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: event.url,
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isLnUrl(event.url)) {
      // at this point we can not tell if it is lnurl-pay or lnurl-withdraw since it needs additional async call
      // to the server, which is undesirable here, so LNDCreateInvoice screen will handle it for us and will
      // redirect user to LnurlPay screen if necessary
      completionHandler([
        'LNDCreateInvoiceRoot',
        {
          screen: 'LNDCreateInvoice',
          params: {
            uri: event.url.replace('lightning:', '').replace('LIGHTNING:', ''),
          },
        },
      ]);
    } else if (Lnurl.isLightningAddress(event.url)) {
      // this might be not just an email but a lightning addres
      // @see https://lightningaddress.com
      completionHandler([
        'ScanLndInvoiceRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: event.url,
          },
        },
      ]);
    } else if (DeeplinkSchemaMatch.isSafelloRedirect(event)) {
      const urlObject = url.parse(event.url, true); // eslint-disable-line node/no-deprecated-api

      const safelloStateToken = urlObject.query['safello-state-token'];
      let wallet;
      // eslint-disable-next-line no-unreachable-loop
      for (const w of context.wallets) {
        wallet = w;
        break;
      }

      completionHandler([
        'BuyBitcoin',
        {
          uri: event.url,
          safelloStateToken,
          walletID: wallet?.getID(),
        },
      ]);
    } else if (Azteco.isRedeemUrl(event.url)) {
      completionHandler([
        'AztecoRedeemRoot',
        {
          screen: 'AztecoRedeem',
          params: Azteco.getParamsFromUrl(event.url),
        },
      ]);
    } else if (new WatchOnlyWallet().setSecret(event.url).init().valid()) {
      completionHandler([
        'AddWalletRoot',
        {
          screen: 'ImportWallet',
          params: {
            triggerImport: true,
            label: event.url,
          },
        },
      ]);
    } else {
      const urlObject = url.parse(event.url, true); // eslint-disable-line node/no-deprecated-api
      (async () => {
        if (urlObject.protocol === 'bflwallet:') {
          if (urlObject.host === 'setelectrumserver') {
            completionHandler([
              'ElectrumSettings',
              {
                server: DeeplinkSchemaMatch.getServerFromSetElectrumServerAction(event.url),
              },
            ]);
          }
        }
      })();
    }
  }

  /**
   * Extracts server from a deeplink like `bflwallet:setelectrumserver?server=electrum1.bluewallet.io%3A443%3As`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getServerFromSetElectrumServerAction(url) {
    if (!url.startsWith('bflwallet:setelectrumserver') && !url.startsWith('setelectrumserver')) return false;
    const splt = url.split('server=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  /**
   * Extracts url from a deeplink like `bflwallet:setlndhuburl?url=https%3A%2F%2Flndhub.herokuapp.com`
   * returns FALSE if none found
   *
   * @param url {string}
   * @return {string|boolean}
   */
  static getUrlFromSetLndhubUrlAction(url) {
    if (!url.startsWith('bflwallet:setlndhuburl') && !url.startsWith('setlndhuburl')) return false;
    const splt = url.split('url=');
    if (splt[1]) return decodeURIComponent(splt[1]);
    return false;
  }

  static isTXNFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.txn')
    );
  }

  static isPossiblySignedPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('-signed.psbt')
    );
  }

  static isPossiblyPSBTFile(filePath) {
    return (
      (filePath.toLowerCase().startsWith('file:') || filePath.toLowerCase().startsWith('content:')) &&
      filePath.toLowerCase().endsWith('.psbt')
    );
  }

  static isBothBitcoinAndLightningOnWalletSelect(wallet, uri) {
    if (wallet.chain === Chain.ONCHAIN) {
      return [
        'SendDetailsRoot',
        {
          screen: 'SendDetails',
          params: {
            uri: uri.bitcoin,
            walletID: wallet.getID(),
          },
        },
      ];
    } else if (wallet.chain === Chain.OFFCHAIN) {
      return [
        'ScanLndInvoiceRoot',
        {
          screen: 'ScanLndInvoice',
          params: {
            uri: uri.lndInvoice,
            walletID: wallet.getID(),
          },
        },
      ];
    }
  }

  static isBitcoinAddress(address) {
    address = address.replace('bitflate:', '').replace('BITFLATE:', '').replace('bitflate=', '').split('?')[0];
    let isValidBitcoinAddress = false;
    try {
      bitcoin.address.toOutputScript(address);
      isValidBitcoinAddress = true;
    } catch (err) {
      isValidBitcoinAddress = false;
    }
    return isValidBitcoinAddress;
  }

  static isLightningInvoice(invoice) {
    let isValidLightningInvoice = false;
    if (invoice.toLowerCase().startsWith('lightning:lnb') || invoice.toLowerCase().startsWith('lnb')) {
      isValidLightningInvoice = true;
    }
    return isValidLightningInvoice;
  }

  static isLnUrl(text) {
    return Lnurl.isLnurl(text);
  }

  static isWidgetAction(text) {
    return text.startsWith('widget?action=');
  }

  static isSafelloRedirect(event) {
    const urlObject = url.parse(event.url, true); // eslint-disable-line node/no-deprecated-api

    return !!urlObject.query['safello-state-token'];
  }

  static isBothBitcoinAndLightning(url) {
    if (url.includes('lightning') && (url.includes('bitflate') || url.includes('BITFLATE'))) {
      const txInfo = url.split(/(bitflate:|BITFLATE:|lightning:|lightning=|bitflate=)+/);
      let bitcoin;
      let lndInvoice;
      for (const [index, value] of txInfo.entries()) {
        try {
          // Inside try-catch. We dont wan't to  crash in case of an out-of-bounds error.
          if (value.startsWith('bitflate') || value.startsWith('BITFLATE')) {
            bitcoin = `bitflate:${txInfo[index + 1]}`;
            if (!DeeplinkSchemaMatch.isBitcoinAddress(bitcoin)) {
              bitcoin = false;
              break;
            }
          } else if (value.startsWith('lightning')) {
            lndInvoice = `lightning:${txInfo[index + 1]}`;
            if (!this.isLightningInvoice(lndInvoice)) {
              lndInvoice = false;
              break;
            }
          }
        } catch (e) {
          console.log(e);
        }
        if (bitcoin && lndInvoice) break;
      }
      if (bitcoin && lndInvoice) {
        return { bitcoin, lndInvoice };
      } else {
        return undefined;
      }
    }
    return undefined;
  }

  static bip21decode(uri) {
    if (!uri || uri.startsWith('bitcoin')) return {};
    return bip21.decode(uri.replace('BITFLATE:', 'bitflate:'), 'bitflate');
  }

  static bip21encode() {
    return bip21.encode.apply(bip21, arguments).replace('bitcoin:', 'bitflate:');
  }

  static decodeBitcoinUri(uri) {
    let amount = '';
    let parsedBitcoinUri = null;
    let address = uri || '';
    let memo = '';
    let payjoinUrl = '';
    try {
      parsedBitcoinUri = DeeplinkSchemaMatch.bip21decode(uri);
      address = 'address' in parsedBitcoinUri ? parsedBitcoinUri.address : address;
      if ('options' in parsedBitcoinUri) {
        if ('amount' in parsedBitcoinUri.options) {
          amount = parsedBitcoinUri.options.amount.toString();
          amount = parsedBitcoinUri.options.amount;
        }
        if ('label' in parsedBitcoinUri.options) {
          memo = parsedBitcoinUri.options.label || memo;
        }
        if ('pj' in parsedBitcoinUri.options) {
          payjoinUrl = parsedBitcoinUri.options.pj;
        }
      }
    } catch (_) {}
    return { address, amount, memo, payjoinUrl };
  }
}

export default DeeplinkSchemaMatch;
