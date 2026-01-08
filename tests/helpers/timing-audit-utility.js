
const fs = require('fs');
const path = require('path');

const auditTestFile = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    
    const timingPatterns = {
        setTimeout: (content.match(/setTimeout\s*\(/g) || []).length,
        setInterval: (content.match(/setInterval\s*\(/g) || []).length,
        promiseDelay: (content.match(/new Promise\s*\(\s*resolve\s*=>\s*setTimeout/g) || []).length,
        sleep: (content.match(/sleep\s*\(/g) || []).length,
        delay: (content.match(/await.*delay\s*\(/g) || []).length
    };
    
    const implementationPatterns = {
        mockCallVerification: (content.match(/toHaveBeenCalledWith\s*\(/g) || []).length,
        mockCalledTimes: (content.match(/toHaveBeenCalledTimes\s*\(/g) || []).length,
        internalPropertyAccess: (content.match(/expect\s*\([^)]*\.[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)\s*\.toBe/g) || []).length,
        implementationSteps: (content.match(/\.(parsed|validated|formatted|processed|queued|displayed)\s*\)/g) || []).length,
        internalStateChecking: (content.match(/\.state\.|\.internal|\.step[0-9]|\.phase[0-9]/g) || []).length
    };
    
    const totalTimingIssues = Object.values(timingPatterns).reduce((sum, count) => sum + count, 0);
    const totalImplementationIssues = Object.values(implementationPatterns).reduce((sum, count) => sum + count, 0);
    
    // Calculate priority score (higher = more urgent)
    const priorityScore = (totalTimingIssues * 2) + totalImplementationIssues;
    
    return {
        filePath,
        timingPatterns,
        implementationPatterns,
        totalTimingIssues,
        totalImplementationIssues,
        priorityScore,
        urgency: getPriorityLevel(priorityScore)
    };
};

const getPriorityLevel = (score) => {
    if (score >= 20) return 'CRITICAL';
    if (score >= 10) return 'HIGH';
    if (score >= 5) return 'MEDIUM';
    if (score >= 1) return 'LOW';
    return 'CLEAN';
};

const auditTestDirectory = (testDir) => {
    const results = [];
    
    const scanDirectory = (dir) => {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                scanDirectory(fullPath);
            } else if (item.endsWith('.test.js')) {
                try {
                    const audit = auditTestFile(fullPath);
                    results.push(audit);
                } catch (error) {
                    console.warn(`Warning: Could not audit ${fullPath}: ${error.message}`);
                }
            }
        }
    };
    
    scanDirectory(testDir);
    return results;
};

const generateAuditReport = (auditResults) => {
    // Sort by priority score (highest first)
    const sortedResults = auditResults.sort((a, b) => b.priorityScore - a.priorityScore);
    
    // Calculate totals
    const totals = auditResults.reduce((acc, result) => {
        acc.files++;
        acc.timingIssues += result.totalTimingIssues;
        acc.implementationIssues += result.totalImplementationIssues;
        acc.totalScore += result.priorityScore;
        return acc;
    }, { files: 0, timingIssues: 0, implementationIssues: 0, totalScore: 0 });
    
    // Group by urgency
    const byUrgency = {
        CRITICAL: sortedResults.filter(r => r.urgency === 'CRITICAL'),
        HIGH: sortedResults.filter(r => r.urgency === 'HIGH'),
        MEDIUM: sortedResults.filter(r => r.urgency === 'MEDIUM'),
        LOW: sortedResults.filter(r => r.urgency === 'LOW'),
        CLEAN: sortedResults.filter(r => r.urgency === 'CLEAN')
    };
    
    return {
        summary: {
            totalFiles: totals.files,
            totalTimingIssues: totals.timingIssues,
            totalImplementationIssues: totals.implementationIssues,
            averageScore: Math.round(totals.totalScore / totals.files),
            filesNeedingConversion: auditResults.filter(r => r.priorityScore > 0).length
        },
        byUrgency,
        sortedResults,
        recommendations: generateRecommendations(byUrgency)
    };
};

const generateRecommendations = (byUrgency) => {
    const recommendations = [];
    
    if (byUrgency.CRITICAL.length > 0) {
        recommendations.push({
            priority: 'CRITICAL',
            action: 'Immediate conversion required',
            files: byUrgency.CRITICAL.slice(0, 5),
            reason: 'These files have the highest concentration of timing dependencies and implementation focus'
        });
    }
    
    if (byUrgency.HIGH.length > 0) {
        recommendations.push({
            priority: 'HIGH',
            action: 'Convert within current sprint',
            files: byUrgency.HIGH.slice(0, 10),
            reason: 'Significant timing dependencies that impact test reliability'
        });
    }
    
    if (byUrgency.MEDIUM.length > 0) {
        recommendations.push({
            priority: 'MEDIUM',
            action: 'Schedule for next sprint',
            files: byUrgency.MEDIUM.slice(0, 15),
            reason: 'Moderate issues that would benefit from conversion'
        });
    }
    
    return recommendations;
};

const generateConversionPlan = (auditResult) => {
    const plan = {
        file: auditResult.filePath,
        urgency: auditResult.urgency,
        steps: []
    };
    
    // Timing conversion steps
    if (auditResult.timingPatterns.setTimeout > 0) {
        plan.steps.push({
            step: 'Convert setTimeout to waitForEvent',
            count: auditResult.timingPatterns.setTimeout,
            pattern: 'setTimeout',
            replacement: 'waitForEvent(emitter, eventName)'
        });
    }
    
    if (auditResult.timingPatterns.promiseDelay > 0) {
        plan.steps.push({
            step: 'Convert Promise delays to event-driven waiting',
            count: auditResult.timingPatterns.promiseDelay,
            pattern: 'new Promise(resolve => waitForDelay(ms))',
            replacement: 'waitFor(() => condition())'
        });
    }
    
    // Implementation conversion steps
    if (auditResult.implementationPatterns.mockCallVerification > 0) {
        plan.steps.push({
            step: 'Convert mock call verification to user experience validation',
            count: auditResult.implementationPatterns.mockCallVerification,
            pattern: 'toHaveBeenCalledWith',
            replacement: 'observeUserExperience + expectUserExperience'
        });
    }
    
    if (auditResult.implementationPatterns.implementationSteps > 0) {
        plan.steps.push({
            step: 'Convert implementation step validation to user outcome validation',
            count: auditResult.implementationPatterns.implementationSteps,
            pattern: 'expect(result.parsed).toBe(true)',
            replacement: 'expect(userExperience.sawCorrectResult).toBe(true)'
        });
    }
    
    return plan;
};

const runTimingAudit = (testDirectory = '/mnt/c/Users/h/Programs/runtime/tests') => {
    console.log('Starting timing dependencies and implementation focus audit...\n');
    
    const auditResults = auditTestDirectory(testDirectory);
    const report = generateAuditReport(auditResults);
    
    console.log('AUDIT SUMMARY');
    console.log('================');
    console.log(`Total test files analyzed: ${report.summary.totalFiles}`);
    console.log(`Files needing conversion: ${report.summary.filesNeedingConversion}`);
    console.log(`Total timing issues: ${report.summary.totalTimingIssues}`);
    console.log(`Total implementation issues: ${report.summary.totalImplementationIssues}`);
    console.log(`Average priority score: ${report.summary.averageScore}\n`);
    
    console.log('PRIORITY BREAKDOWN');
    console.log('====================');
    Object.keys(report.byUrgency).forEach(priority => {
        const files = report.byUrgency[priority];
        if (files.length > 0) {
            console.log(`${priority}: ${files.length} files`);
        }
    });
    console.log();
    
    console.log('TOP PRIORITY FILES FOR CONVERSION');
    console.log('===================================');
    const topFiles = report.sortedResults.filter(r => r.priorityScore > 0).slice(0, 10);
    topFiles.forEach((file, index) => {
        console.log(`${index + 1}. ${path.basename(file.filePath)} (Score: ${file.priorityScore})`);
        console.log(`   Timing issues: ${file.totalTimingIssues}, Implementation issues: ${file.totalImplementationIssues}`);
    });
    console.log();
    
    console.log('RECOMMENDATIONS');
    console.log('==================');
    report.recommendations.forEach(rec => {
        console.log(`${rec.priority}: ${rec.action}`);
        console.log(`   Reason: ${rec.reason}`);
        console.log(`   Files: ${rec.files.length > 3 ? rec.files.slice(0, 3).map(f => path.basename(f.filePath)).join(', ') + '...' : rec.files.map(f => path.basename(f.filePath)).join(', ')}`);
        console.log();
    });
    
    return report;
};

module.exports = {
    auditTestFile,
    auditTestDirectory,
    generateAuditReport,
    generateConversionPlan,
    runTimingAudit
};
