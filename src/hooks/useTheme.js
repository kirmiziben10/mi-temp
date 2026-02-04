import { useState, useEffect } from 'react';

/**
 * Custom hook to manage application theme (light/dark)
 * Persists preference to localStorage and applies data-theme attribute to document.
 * 
 * @returns {Object} Theme state and toggle function
 */
export const useTheme = () => {
    // Load theme from localStorage or default to 'light'
    const [theme, setTheme] = useState(() => {
        try {
            const savedTheme = localStorage.getItem('miTempTheme');
            return savedTheme || 'light';
        } catch (e) {
            console.warn('Failed to read theme from localStorage', e);
            return 'light';
        }
    });

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => {
            const newTheme = prev === 'light' ? 'dark' : 'light';
            try {
                localStorage.setItem('miTempTheme', newTheme);
            } catch (e) {
                console.warn('Failed to save theme to localStorage', e);
            }
            return newTheme;
        });
    };

    return { theme, toggleTheme, isDark: theme === 'dark' };
};
