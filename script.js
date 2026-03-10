// ETH Wallet - Web3.js Integration
class EthWallet {
    constructor() {
        this.web3 = null;
        this.account = null;
        this.balance = '0';
        this.ethPrice = 0;
        this.chainId = null;
        this.networkNames = {
            1: 'Ethereum Mainnet',
            5: 'Goerli Testnet',
            11155111: 'Sepolia Testnet',
            137: 'Polygon Mainnet',
            80001: 'Polygon Mumbai',
            42161: 'Arbitrum One'
        };
        this.init();
    }

    init() {
        this.detectWeb3();
        this.setupEventListeners();
        this.fetchETHPrice();
    }

    detectWeb3() {
        if (typeof window.ethereum !== 'undefined') {
            this.web3 = new Web3(window.ethereum);
            this.setupWeb3Listeners();
        } else {
            this.showAlert('Please install MetaMask or a Web3 wallet provider', 'error');
        }
    }

    setupWeb3Listeners() {
        if (!window.ethereum) return;

        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length > 0) {
                this.account = accounts[0];
                this.updateDisplay();
            } else {
                this.disconnect();
            }
        });

        window.ethereum.on('chainChanged', () => {
            location.reload();
        });

        window.ethereum.on('connect', () => {
            this.updateNetworkStatus();
        });

        window.ethereum.on('disconnect', () => {
            this.disconnect();
        });
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.target.getAttribute('onclick').match(/'([^']+)'/)[1]);
            });
        });
    }

    async connectWallet() {
        try {
            const btn = document.getElementById('connectBtn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>Connecting...';

            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            if (accounts.length > 0) {
                this.account = accounts[0];
                await this.updateNetworkStatus();
                await this.updateDisplay();
                btn.innerHTML = '✓ Connected';
            }
        } catch (error) {
            console.error('Connection error:', error);
            this.showAlert('Failed to connect wallet. ' + error.message, 'error');
            document.getElementById('connectBtn').disabled = false;
            document.getElementById('connectBtn').innerHTML = 'Connect Wallet';
        }
    }

    async updateNetworkStatus() {
        try {
            const chainId = await this.web3.eth.net.getId();
            this.chainId = chainId;
            const networkName = this.networkNames[chainId] || `Network ID: ${chainId}`;
            document.getElementById('networkName').textContent = networkName;
            document.getElementById('networkBadge').className = 'network-badge';
            document.getElementById('networkBadge').style.background = 'rgba(102, 126, 234, 0.2)';
        } catch (error) {
            console.error('Error updating network status:', error);
        }
    }

    async updateDisplay() {
        if (!this.account) return;

        // Update address display
        const shortAddress = this.account.substring(0, 6) + '...' + this.account.substring(38);
        document.getElementById('accountAddress').textContent = this.account;
        document.getElementById('receiveAddress').textContent = this.account;

        // Fetch and display balance
        await this.refreshBalance();

        // Generate QR code
        this.generateQRCode();
    }

    async refreshBalance() {
        try {
            if (!this.account || !this.web3) return;

            const balanceWei = await this.web3.eth.getBalance(this.account);
            this.balance = this.web3.utils.fromWei(balanceWei, 'ether');

            const balanceDisplay = parseFloat(this.balance).toFixed(4);
            document.getElementById('balanceAmount').textContent = `${balanceDisplay} ETH`;

            // Calculate USD value
            const usdValue = (parseFloat(this.balance) * this.ethPrice).toFixed(2);
            document.getElementById('balanceUSD').textContent = `$${usdValue}`;

            this.showAlert(`Balance updated: ${balanceDisplay} ETH`, 'success');
        } catch (error) {
            console.error('Error fetching balance:', error);
            this.showAlert('Failed to fetch balance', 'error');
        }
    }

    generateQRCode() {
        const container = document.getElementById('qrCode');
        container.innerHTML = '';

        if (!this.account) {
            container.innerHTML = '<p>Connect wallet to generate QR code</p>';
            return;
        }

        new QRCode(container, {
            text: this.account,
            width: 200,
            height: 200,
            colorDark: '#667eea',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    async sendETH() {
        try {
            const recipientAddress = document.getElementById('recipientAddress').value.trim();
            const amount = document.getElementById('amount').value;

            // Validation
            if (!recipientAddress) {
                this.showAlert('Please enter recipient address', 'error');
                return;
            }

            if (!this.web3.utils.isAddress(recipientAddress)) {
                this.showAlert('Invalid Ethereum address', 'error');
                return;
            }

            if (!amount || parseFloat(amount) <= 0) {
                this.showAlert('Please enter a valid amount', 'error');
                return;
            }

            if (parseFloat(amount) > parseFloat(this.balance)) {
                this.showAlert('Insufficient balance', 'error');
                return;
            }

            // Show transaction modal
            this.showTransactionModal('Confirming transaction...', 'pending');

            const amountWei = this.web3.utils.toWei(amount, 'ether');

            // Get gas estimate
            let gasEstimate;
            try {
                gasEstimate = await this.web3.eth.estimateGas({
                    from: this.account,
                    to: recipientAddress,
                    value: amountWei
                });
            } catch (error) {
                gasEstimate = 21000;
            }

            // Get gas price
            const gasPrice = await this.web3.eth.getGasPrice();

            // Create transaction object
            const transactionObject = {
                from: this.account,
                to: recipientAddress,
                value: amountWei,
                gas: gasEstimate,
                gasPrice: gasPrice
            };

            // Send transaction
            const txHash = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [transactionObject]
            });

            this.showTransactionModal(
                `Transaction submitted! Hash: ${txHash.substring(0, 10)}...`,
                'submitted',
                txHash
            );

            // Clear form
            document.getElementById('recipientAddress').value = '';
            document.getElementById('amount').value = '';

            // Wait for confirmation
            this.waitForTransactionConfirmation(txHash);

        } catch (error) {
            console.error('Send error:', error);
            this.showAlert('Transaction failed: ' + error.message, 'error');
            this.showTransactionModal('Transaction failed', 'error');
        }
    }

    async waitForTransactionConfirmation(txHash) {
        try {
            let receipt = null;
            let attempts = 0;
            const maxAttempts = 60;

            while (!receipt && attempts < maxAttempts) {
                receipt = await this.web3.eth.getTransactionReceipt(txHash);
                if (!receipt) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                attempts++;
            }

            if (receipt) {
                const status = receipt.status ? 'success' : 'failed';
                const message = status === 'success'
                    ? `Transaction confirmed! Block: ${receipt.blockNumber}`
                    : 'Transaction failed on-chain';

                this.showTransactionModal(message, status, txHash);
                await this.refreshBalance();
            } else {
                this.showTransactionModal('Transaction pending - check back later', 'pending', txHash);
            }
        } catch (error) {
            console.error('Error waiting for confirmation:', error);
        }
    }

    async fetchETHPrice() {
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
            const data = await response.json();
            this.ethPrice = data.ethereum?.usd || 0;
            if (this.balance !== '0') {
                const usdValue = (parseFloat(this.balance) * this.ethPrice).toFixed(2);
                document.getElementById('balanceUSD').textContent = `$${usdValue}`;
            }
        } catch (error) {
            console.error('Error fetching ETH price:', error);
        }
    }

    switchTab(tabName) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });

        // Remove active from all tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // Show selected tab
        const tabId = tabName + 'Tab';
        const tabElement = document.getElementById(tabId);
        if (tabElement) {
            tabElement.classList.add('active');
        }

        // Mark button as active
        event.target.classList.add('active');

        // Special handling for receive tab
        if (tabName === 'receive') {
            this.generateQRCode();
        }
    }

    showAlert(message, type = 'info') {
        const container = document.getElementById('alertContainer');
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;

        container.appendChild(alert);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            alert.remove();
        }, 5000);
    }

    showTransactionModal(message, status = 'pending', txHash = null) {
        const modal = document.getElementById('txModal');
        const title = document.getElementById('txModalTitle');
        const body = document.getElementById('txModalBody');

        title.textContent = status === 'success' ? '✓ Success' : status === 'error' ? '✗ Error' : '⏳ Processing';

        let html = `<p>${message}</p>`;

        if (txHash) {
            const explorerUrls = {
                1: 'https://etherscan.io/tx/',
                5: 'https://goerli.etherscan.io/tx/',
                11155111: 'https://sepolia.etherscan.io/tx/',
                137: 'https://polygonscan.com/tx/',
                80001: 'https://mumbai.polygonscan.com/tx/',
                42161: 'https://arbiscan.io/tx/'
            };

            const explorerUrl = explorerUrls[this.chainId] || 'https://etherscan.io/tx/';
            html += `<div class="divider"></div>`;
            html += `<p style="font-size: 12px; color: #8b92a0;">Transaction Hash:</p>`;
            html += `<p style="font-family: monospace; font-size: 11px; word-break: break-all; margin-bottom: 12px;">${txHash}</p>`;
            html += `<a href="${explorerUrl}${txHash}" target="_blank" class="btn-primary" style="display: block; text-align: center; text-decoration: none;">View on Explorer</a>`;
        }

        body.innerHTML = html;
        modal.classList.add('active');
    }

    closeTxModal() {
        document.getElementById('txModal').classList.remove('active');
    }

    copyToClipboard() {
        const addressElement = event.target.closest('.address-display');
        const address = addressElement.textContent;

        if (!address || address.includes('Click')) {
            this.showAlert('Wallet not connected', 'error');
            return;
        }

        navigator.clipboard.writeText(address).then(() => {
            this.showAlert('Address copied to clipboard!', 'success');
        }).catch(() => {
            this.showAlert('Failed to copy address', 'error');
        });
    }

    disconnect() {
        this.account = null;
        this.balance = '0';
        document.getElementById('balanceAmount').textContent = '0.00 ETH';
        document.getElementById('balanceUSD').textContent = '$0.00';
        document.getElementById('accountAddress').textContent = 'Click "Connect Wallet" to display address';
        document.getElementById('receiveAddress').textContent = 'Click "Connect Wallet" to display address';
        document.getElementById('qrCode').innerHTML = '';
        document.getElementById('connectBtn').disabled = false;
        document.getElementById('connectBtn').innerHTML = 'Connect Wallet';
        document.getElementById('networkName').textContent = 'Disconnected';
        this.showAlert('Wallet disconnected', 'info');
    }
}

// Global function wrappers for HTML onclick handlers
let wallet;

function connectWallet() {
    if (!wallet) wallet = new EthWallet();
    wallet.connectWallet();
}

function switchTab(tabName) {
    if (!wallet) wallet = new EthWallet();
    wallet.switchTab(tabName);
}

function sendETH() {
    if (!wallet) wallet = new EthWallet();
    wallet.sendETH();
}

function refreshBalance() {
    if (!wallet) wallet = new EthWallet();
    wallet.refreshBalance();
}

function copyToClipboard() {
    if (!wallet) wallet = new EthWallet();
    wallet.copyToClipboard();
}

function closeTxModal() {
    if (!wallet) wallet = new EthWallet();
    wallet.closeTxModal();
}

// Initialize wallet on page load
document.addEventListener('DOMContentLoaded', () => {
    wallet = new EthWallet();
});